import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { polygon } from "viem/chains";
import { createApp } from "../app";
import { decryptPrivateKey, resolveEncryptionKey } from "../crypto/encryption";
import { createDatabaseClient } from "../db/client";
import { users } from "../db/schema";
import { RelayerError } from "../errors";
import type { RuntimeConfig } from "../polymarket/config";

const testConfig: RuntimeConfig = {
  relayerUrl: "https://relayer.polymarket.com",
  rpcUrl: "https://polygon-rpc.com",
  chainId: 137,
  chain: polygon,
  builderApiKey: "builder-key",
  builderSecret: "builder-secret",
  builderPassphrase: "builder-passphrase",
  encryptionKey: resolveEncryptionKey("12345678901234567890123456789012"),
};

const bootstrapResult = {
  privateKey: "0xabc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd",
  walletAddress: "0x1111111111111111111111111111111111111111",
  safeAddress: "0x2222222222222222222222222222222222222222",
  safeDeploymentTransactionId: "deploy-1",
  safeDeploymentTransactionHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
  approvalTransactionId: "approval-1",
  approvalTransactionHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
} as const;

const createRequest = (body: unknown) =>
  new Request("http://localhost/user", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /user", () => {
  let sqlite: ReturnType<typeof createDatabaseClient>["sqlite"];
  let db: ReturnType<typeof createDatabaseClient>["db"];

  beforeEach(() => {
    const client = createDatabaseClient(":memory:");
    sqlite = client.sqlite;
    db = client.db;
  });

  test("returns 400 for malformed JSON", async () => {
    const app = createApp({ db });
    const response = await app.request(
      new Request("http://localhost/user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{bad-json",
      }),
    );

    expect(response.status).toBe(400);
    await sqlite.close();
  });

  test("returns 409 and never bootstraps when the phone already exists", async () => {
    db.insert(users)
      .values({
        displayName: "Existing",
        phoneNumber: "555-0100",
        encryptedPrivateKey: "encrypted",
        walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        safeAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        safeDeploymentTransactionId: "deploy-existing",
        safeDeploymentTransactionHash:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        approvalTransactionId: "approval-existing",
        approvalTransactionHash:
          "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      })
      .run();

    let called = false;
    const app = createApp({
      db,
      loadRuntimeConfig: () => testConfig,
      bootstrapWallet: async () => {
        called = true;
        return bootstrapResult;
      },
    });

    const response = await app.request(
      createRequest({ displayName: "Alice", phoneNumber: "555-0100" }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "A user with that phone number already exists.",
    });
    expect(called).toBe(false);
    await sqlite.close();
  });

  test("creates the user after successful bootstrap", async () => {
    const app = createApp({
      db,
      loadRuntimeConfig: () => testConfig,
      bootstrapWallet: async () => bootstrapResult,
    });

    const response = await app.request(
      createRequest({ displayName: "Alice", phoneNumber: "555-0101" }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.user).toMatchObject({
      id: 1,
      displayName: "Alice",
      phoneNumber: "555-0101",
      walletAddress: bootstrapResult.walletAddress,
      safeAddress: bootstrapResult.safeAddress,
      safeDeploymentTransactionHash:
        bootstrapResult.safeDeploymentTransactionHash,
      approvalTransactionHash: bootstrapResult.approvalTransactionHash,
    });

    const stored = db.select().from(users).where(eq(users.id, 1)).get();

    expect(stored).toBeDefined();
    expect(stored?.encryptedPrivateKey).not.toBe(bootstrapResult.privateKey);
    expect(
      decryptPrivateKey(stored!.encryptedPrivateKey, testConfig.encryptionKey),
    ).toBe(bootstrapResult.privateKey);
    await sqlite.close();
  });

  test("returns 502 when wallet deployment fails", async () => {
    const app = createApp({
      db,
      loadRuntimeConfig: () => testConfig,
      bootstrapWallet: async () => {
        throw new RelayerError("Safe deployment failed.");
      },
    });

    const response = await app.request(
      createRequest({ displayName: "Alice", phoneNumber: "555-0102" }),
    );

    expect(response.status).toBe(502);
    expect(db.select().from(users).all()).toHaveLength(0);
    await sqlite.close();
  });

  test("returns 502 when approvals fail", async () => {
    const app = createApp({
      db,
      loadRuntimeConfig: () => testConfig,
      bootstrapWallet: async () => {
        throw new RelayerError("Token approvals failed.");
      },
    });

    const response = await app.request(
      createRequest({ displayName: "Alice", phoneNumber: "555-0103" }),
    );

    expect(response.status).toBe(502);
    expect(db.select().from(users).all()).toHaveLength(0);
    await sqlite.close();
  });

  test("returns 500 when the insert fails after bootstrap", async () => {
    db.insert(users)
      .values({
        displayName: "Existing",
        phoneNumber: "555-0199",
        encryptedPrivateKey: "encrypted",
        walletAddress: bootstrapResult.walletAddress,
        safeAddress: "0xffffffffffffffffffffffffffffffffffffffff",
        safeDeploymentTransactionId: "deploy-existing",
        safeDeploymentTransactionHash:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        approvalTransactionId: "approval-existing",
        approvalTransactionHash:
          "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      })
      .run();

    const app = createApp({
      db,
      loadRuntimeConfig: () => testConfig,
      bootstrapWallet: async () => bootstrapResult,
    });

    const response = await app.request(
      createRequest({ displayName: "Alice", phoneNumber: "555-0104" }),
    );

    expect(response.status).toBe(500);
    expect(db.select().from(users).all()).toHaveLength(1);
    await sqlite.close();
  });

  test("migrates the expanded users table on a fresh database", async () => {
    const columns = sqlite
      .query("PRAGMA table_info(users)")
      .all() as Array<{ name: string }>;

    expect(columns.map(column => column.name)).toEqual([
      "id",
      "display_name",
      "phone_number",
      "encrypted_private_key",
      "wallet_address",
      "safe_address",
      "safe_deployment_transaction_id",
      "safe_deployment_transaction_hash",
      "approval_transaction_id",
      "approval_transaction_hash",
    ]);

    await sqlite.close();
  });
});
