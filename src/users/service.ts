import { eq } from "drizzle-orm";
import { encryptPrivateKey } from "../crypto/encryption";
import { ConflictError, DatabaseError } from "../errors";
import { bootstrapPolymarketWallet, type WalletBootstrapResult } from "../polymarket/bootstrap";
import {
  loadRuntimeConfig,
  type RuntimeConfig,
} from "../polymarket/config";
import { getDb, type AppDatabase } from "../db/client";
import { users } from "../db/schema";

export type CreateUserInput = {
  displayName: string;
  phoneNumber: string;
};

export type PublicUser = {
  id: number;
  displayName: string;
  phoneNumber: string;
  walletAddress: string;
  safeAddress: string;
  safeDeploymentTransactionHash: string;
  approvalTransactionHash: string;
};

type BootstrapWallet = (config: RuntimeConfig) => Promise<WalletBootstrapResult>;
type LoadRuntimeConfig = () => RuntimeConfig;
type EncryptPrivateKey = (privateKey: string, encryptionKey: Buffer) => string;

export type CreateUserServiceDeps = {
  db?: AppDatabase;
  bootstrapWallet?: BootstrapWallet;
  loadRuntimeConfig?: LoadRuntimeConfig;
  encryptPrivateKey?: EncryptPrivateKey;
};

const isUniqueConstraintError = (error: unknown, column: string) =>
  error instanceof Error &&
  error.message.includes(`UNIQUE constraint failed: users.${column}`);

const insertUser = (
  db: AppDatabase,
  input: CreateUserInput,
  encryptedPrivateKey: string,
  wallet: WalletBootstrapResult,
) =>
  db
    .insert(users)
    .values({
      displayName: input.displayName,
      phoneNumber: input.phoneNumber,
      encryptedPrivateKey,
      walletAddress: wallet.walletAddress,
      safeAddress: wallet.safeAddress,
      safeDeploymentTransactionId: wallet.safeDeploymentTransactionId,
      safeDeploymentTransactionHash: wallet.safeDeploymentTransactionHash,
      approvalTransactionId: wallet.approvalTransactionId,
      approvalTransactionHash: wallet.approvalTransactionHash,
    })
    .returning({
      id: users.id,
      displayName: users.displayName,
      phoneNumber: users.phoneNumber,
      walletAddress: users.walletAddress,
      safeAddress: users.safeAddress,
      safeDeploymentTransactionHash: users.safeDeploymentTransactionHash,
      approvalTransactionHash: users.approvalTransactionHash,
    })
    .get();

export const createUserService = ({
  db: injectedDb,
  bootstrapWallet = bootstrapPolymarketWallet,
  loadRuntimeConfig: loadConfig = loadRuntimeConfig,
  encryptPrivateKey: encrypt = encryptPrivateKey,
}: CreateUserServiceDeps = {}) => {
  return async (input: CreateUserInput): Promise<PublicUser> => {
    const db = injectedDb ?? getDb();
    const existingUser = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phoneNumber, input.phoneNumber))
      .get();

    if (existingUser) {
      throw new ConflictError("A user with that phone number already exists.");
    }

    const config = loadConfig();
    const wallet = await bootstrapWallet(config);
    const encryptedKey = encrypt(wallet.privateKey, config.encryptionKey);

    try {
      return insertUser(db, input, encryptedKey, wallet);
    } catch (error) {
      if (isUniqueConstraintError(error, "phone_number")) {
        throw new ConflictError("A user with that phone number already exists.");
      }

      throw new DatabaseError(
        "Failed to persist the newly created user after wallet bootstrap.",
        error,
      );
    }
  };
};
