import {
  AssetType,
  ClobClient,
  OrderType,
  Side,
  SignatureType,
  type ApiKeyCreds,
  type BalanceAllowanceParams,
} from "@polymarket/clob-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { asc, eq } from "drizzle-orm";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decryptPrivateKey } from "../crypto/encryption";
import { getDb, type AppDatabase } from "../db/client";
import { polymarketTradeAttempts, users } from "../db/schema";
import {
  DatabaseError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  UpstreamError,
  ValidationError,
} from "../errors";
import {
  getIndexedPolymarketMarketBySlug,
  normalizePolymarketSlug,
} from "./indexing";
import {
  loadTradeRuntimeConfig,
  type TradeRuntimeConfig,
} from "./config";
import { JsonRpcProvider, Wallet } from "ethers";

type BalanceAllowanceResponse = {
  balance: string;
  allowance: string;
};

type MarketOrderResponse = {
  success?: boolean;
  errorMsg?: string;
  orderID?: string;
  status?: string;
  transactionsHashes?: string[];
  takingAmount?: string;
  makingAmount?: string;
};

export type TradePolymarketMarketInput = {
  market: string;
  outcome: string;
  side: "BUY" | "SELL";
};

export type TradePolymarketMarketResult = {
  attemptId: number;
  marketSlug: string;
  conditionId: string;
  outcome: string;
  tokenId: string;
  side: "BUY" | "SELL";
  amount: number;
  limitPrice: number;
  orderType: "FOK";
  orderId: string | null;
  status: string | null;
  transactionHashes: string[];
};

type TradingClient = {
  getBalanceAllowance: (
    params?: BalanceAllowanceParams,
  ) => Promise<BalanceAllowanceResponse>;
  calculateMarketPrice: (
    tokenID: string,
    side: Side,
    amount: number,
    orderType?: OrderType,
  ) => Promise<number>;
  createAndPostMarketOrder: (
    userMarketOrder: {
      tokenID: string;
      price: number;
      amount: number;
      side: Side;
      orderType: OrderType.FOK;
    },
    options: {
      tickSize: "0.1" | "0.01" | "0.001" | "0.0001";
      negRisk: boolean;
    },
    orderType: OrderType.FOK,
  ) => Promise<MarketOrderResponse>;
};

type BuildTradingClientArgs = {
  config: TradeRuntimeConfig;
  privateKey: string;
  safeAddress: string;
};

export type BuildTradingClient = (
  args: BuildTradingClientArgs,
) => Promise<TradingClient>;

export type CreatePolymarketTradeServiceDeps = {
  db?: AppDatabase;
  loadConfig?: () => TradeRuntimeConfig;
  buildTradingClient?: BuildTradingClient;
};

const createTradingBuilderConfig = (config: TradeRuntimeConfig) =>
  new BuilderConfig({
    localBuilderCreds: {
      key: config.builderApiKey,
      secret: config.builderSecret,
      passphrase: config.builderPassphrase,
    },
  });

const createTradeClient = async ({
  config,
  privateKey,
  safeAddress,
}: BuildTradingClientArgs): Promise<TradingClient> => {
  const account = privateKeyToAccount(privateKey as Hex);

  const builderConfig = createTradingBuilderConfig(config);
  // const ethersSigner = new Wallet(viemAccount.address, provider);
  const ethersSigner = new Wallet(privateKey, new JsonRpcProvider(config.rpcUrl))

  return new ClobClient(
    config.clobHost,
    config.chainId,
    ethersSigner,
    {
      key: config.builderApiKey,
      secret: config.builderSecret,
      passphrase: config.builderPassphrase
    },
    2, // signatureType = 2 for embedded wallet EOA to sign for Safe proxy wallet
    safeAddress,
    undefined, // mandatory placeholder
    false,
    builderConfig // Builder order attribution
  );
};

const normalizeNonEmptyString = (value: string, label: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new ValidationError(`\`${label}\` must be a non-empty string.`);
  }

  return trimmed;
};

const normalizePositiveNumber = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`\`${label}\` must be a positive number.`);
  }

  return value;
};

const normalizeStoredAmount = (value: string | null) => {
  if (!value) {
    throw new ValidationError(
      "Indexed Polymarket market does not have an `orderMinSize` value.",
    );
  }

  const amount = Number.parseFloat(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError(
      "Indexed Polymarket market `orderMinSize` must be a positive number.",
    );
  }

  return amount;
};

const normalizeSide = (value: string) => {
  const side = value.trim().toUpperCase();

  if (side !== "BUY" && side !== "SELL") {
    throw new ValidationError("`side` must be either `BUY` or `SELL`.");
  }

  return side;
};

const compareAvailableAmount = (available: string, required: number) =>
  Number.parseFloat(available) >= required;

const updateTradeAttemptFailure = (
  db: AppDatabase,
  attemptId: number,
  errorMessage: string,
) =>
  db
    .update(polymarketTradeAttempts)
    .set({
      status: "failed",
      errorMessage,
      completedAt: new Date().toISOString(),
    })
    .where(eq(polymarketTradeAttempts.id, attemptId))
    .run();

const updateTradeAttemptSuccess = (
  db: AppDatabase,
  attemptId: number,
  response: MarketOrderResponse,
) =>
  db
    .update(polymarketTradeAttempts)
    .set({
      status: "succeeded",
      responseOrderId: response.orderID ?? null,
      responseStatus: response.status ?? null,
      transactionHashesJson: JSON.stringify(response.transactionsHashes ?? []),
      responseJson: JSON.stringify(response),
      completedAt: new Date().toISOString(),
    })
    .where(eq(polymarketTradeAttempts.id, attemptId))
    .run();

const updateTradeAttemptPrepared = (
  db: AppDatabase,
  attemptId: number,
  limitPrice: number,
) =>
  db
    .update(polymarketTradeAttempts)
    .set({
      limitPrice: String(limitPrice),
    })
    .where(eq(polymarketTradeAttempts.id, attemptId))
    .run();

export const createPolymarketTradeService = ({
  db: injectedDb,
  loadConfig = loadTradeRuntimeConfig,
  buildTradingClient = createTradeClient,
}: CreatePolymarketTradeServiceDeps = {}) => {
  return async (
    input: TradePolymarketMarketInput,
  ): Promise<TradePolymarketMarketResult> => {
    const db = injectedDb ?? getDb();
    const config = loadConfig();

    if (!config.liveTradingEnabled) {
      throw new ForbiddenError("Live Polymarket test trading is disabled.");
    }

    const slug = normalizePolymarketSlug(input.market);
    const outcomeName = normalizeNonEmptyString(input.outcome, "outcome");
    const side = normalizeSide(input.side);
    const orderType = "FOK" as const;
    const user = db
      .select({
        id: users.id,
        encryptedPrivateKey: users.encryptedPrivateKey,
        safeAddress: users.safeAddress,
      })
      .from(users)
      .orderBy(asc(users.id))
      .get();

    if (!user) {
      throw new NotFoundError("No users are available for Polymarket trading.");
    }

    const market = getIndexedPolymarketMarketBySlug(db, slug);

    if (!market) {
      throw new NotFoundError("Indexed Polymarket market not found.");
    }

    if (!market.enableOrderBook || !market.acceptingOrders || market.closed) {
      throw new ValidationError(
        "Indexed Polymarket market is not currently accepting order-book trades.",
      );
    }

    const outcome = market.outcomes.find(
      entry => entry.name.trim().toLowerCase() === outcomeName.toLowerCase(),
    );

    if (!outcome) {
      throw new ValidationError("Requested outcome was not found in the indexed market.");
    }

    const amount = normalizeStoredAmount(market.orderMinSize);
    const startedAt = new Date().toISOString();
    let attemptId = 0;

    try {
      const attempt = db
        .insert(polymarketTradeAttempts)
        .values({
          userId: user.id,
          marketSlug: market.slug,
          conditionId: market.conditionId,
          outcome: outcome.name,
          tokenId: outcome.tokenId,
          side,
          amount: String(amount),
          limitPrice: "pending",
          orderType,
          status: "pending",
          live: true,
          startedAt,
        })
        .returning({ id: polymarketTradeAttempts.id })
        .get();

      attemptId = attempt.id;
      const privateKey = decryptPrivateKey(
        user.encryptedPrivateKey,
        config.encryptionKey,
      );
      const client = await buildTradingClient({
        config,
        privateKey,
        safeAddress: user.safeAddress,
      });
      const orderSide = side === "BUY" ? Side.BUY : Side.SELL;
      const balanceParams =
        side === "BUY"
          ? { asset_type: AssetType.COLLATERAL }
          : { asset_type: AssetType.CONDITIONAL, token_id: outcome.tokenId };
      const balance = await client.getBalanceAllowance(balanceParams);

      if (!compareAvailableAmount(balance.balance, amount)) {
        throw new ValidationError("Insufficient balance for the requested trade.");
      }

      if (!compareAvailableAmount(balance.allowance, amount)) {
        throw new ValidationError("Insufficient allowance for the requested trade.");
      }

      const limitPrice = await client.calculateMarketPrice(
        outcome.tokenId,
        orderSide,
        amount,
        OrderType.FOK,
      );
      updateTradeAttemptPrepared(db, attemptId, limitPrice);

      const response = await client.createAndPostMarketOrder(
        {
          tokenID: outcome.tokenId,
          price: limitPrice,
          amount,
          side: orderSide,
          orderType: OrderType.FOK,
        },
        {
          tickSize: market.tickSize as "0.1" | "0.01" | "0.001" | "0.0001",
          negRisk: market.negRisk,
        },
        OrderType.FOK,
      );

      if (response.success === false) {
        throw new UpstreamError(
          response.errorMsg || "Polymarket rejected the submitted market order.",
        );
      }

      updateTradeAttemptSuccess(db, attemptId, response);

      return {
        attemptId,
        marketSlug: market.slug,
        conditionId: market.conditionId,
        outcome: outcome.name,
        tokenId: outcome.tokenId,
        side,
        amount,
        limitPrice,
        orderType,
        orderId: response.orderID ?? null,
        status: response.status ?? null,
        transactionHashes: response.transactionsHashes ?? [],
      };
    } catch (error) {
      if (attemptId !== 0) {
        try {
          updateTradeAttemptFailure(
            db,
            attemptId,
            error instanceof Error ? error.message : "Unknown trade failure.",
          );
        } catch (updateError) {
          throw new DatabaseError(
            "Failed to persist the Polymarket trade attempt outcome.",
            updateError,
          );
        }
      }

      if (error instanceof HttpError) {
        throw error;
      }

      throw new UpstreamError("Failed to execute the Polymarket market order.", error);
    }
  };
};
