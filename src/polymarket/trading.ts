import {
  AssetType,
  ClobClient,
  OrderType,
  Side,
  SignatureType,
  type ApiKeyCreds,
  type BalanceAllowanceParams,
  type OrderBookSummary,
} from "@polymarket/clob-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { asc, eq } from "drizzle-orm";
import { createWalletClient, http, type Hex, type WalletClient } from "viem";
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
  getOrderBook: (tokenID: string) => Promise<OrderBookSummary>;
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

type ApiCredentialClient = Pick<ClobClient, "deriveApiKey" | "createApiKey">;

type CreateWalletClientImpl = (
  config: TradeRuntimeConfig,
  privateKey: Hex,
) => WalletClient;

type CreateApiCredentialClient = (
  config: TradeRuntimeConfig,
  walletClient: WalletClient,
) => ApiCredentialClient;

type CreateAuthenticatedClientArgs = {
  config: TradeRuntimeConfig;
  walletClient: WalletClient;
  apiCreds: ApiKeyCreds;
  signatureType: SignatureType;
  safeAddress: string;
  builderConfig: BuilderConfig;
};

type CreateAuthenticatedClient = (
  args: CreateAuthenticatedClientArgs,
) => TradingClient;

type ResolveTradeApiCredsArgs = {
  config: TradeRuntimeConfig;
  walletClient: WalletClient;
  createApiCredentialClient?: CreateApiCredentialClient;
};

type CreateTradeClientDeps = {
  createWalletClientImpl?: CreateWalletClientImpl;
  createApiCredentialClient?: CreateApiCredentialClient;
  createAuthenticatedClient?: CreateAuthenticatedClient;
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

const createTradingWalletClient: CreateWalletClientImpl = (config, privateKey) => {
  const account = privateKeyToAccount(privateKey);

  return createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
};

const createTradeApiCredentialClient: CreateApiCredentialClient = (
  config,
  walletClient,
) => new ClobClient(config.clobHost, config.chainId, walletClient);

export const resolveTradeApiCreds = async ({
  config,
  walletClient,
  createApiCredentialClient = createTradeApiCredentialClient,
}: ResolveTradeApiCredsArgs): Promise<ApiKeyCreds> => {
  const client = createApiCredentialClient(config, walletClient);

  try {
    return await client.deriveApiKey();
  } catch {
    return client.createApiKey();
  }
};

const createAuthenticatedTradeClient: CreateAuthenticatedClient = ({
  config,
  walletClient,
  apiCreds,
  signatureType,
  safeAddress,
  builderConfig,
}) =>
  new ClobClient(
    config.clobHost,
    config.chainId,
    walletClient,
    apiCreds,
    signatureType,
    safeAddress,
    undefined, // mandatory placeholder
    false,
    builderConfig, // Builder order attribution
  );

export const createTradeClient = async (
  {
    config,
    privateKey,
    safeAddress,
  }: BuildTradingClientArgs,
  {
    createWalletClientImpl = createTradingWalletClient,
    createApiCredentialClient = createTradeApiCredentialClient,
    createAuthenticatedClient = createAuthenticatedTradeClient,
  }: CreateTradeClientDeps = {},
): Promise<TradingClient> => {
  try {
    const walletClient = createWalletClientImpl(config, privateKey as Hex);
    const builderConfig = createTradingBuilderConfig(config);
    const apiCreds = await resolveTradeApiCreds({
      config,
      walletClient,
      createApiCredentialClient,
    });

    return createAuthenticatedClient({
      config,
      walletClient,
      apiCreds,
      signatureType: SignatureType.POLY_GNOSIS_SAFE,
      safeAddress,
      builderConfig,
    });
  } catch (error) {
    throw new UpstreamError(
      "Failed to initialize the Polymarket trading client.",
      error,
    );
  }
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

const calculateBuyMarketPriceForShares = (
  orderBook: Pick<OrderBookSummary, "asks">,
  sharesToBuy: number,
  orderType: OrderType,
) => {
  if (!orderBook.asks.length) {
    throw new Error("no match");
  }

  let sharesMatched = 0;

  for (let index = orderBook.asks.length - 1; index >= 0; index -= 1) {
    const ask = orderBook.asks[index];
    sharesMatched += Number.parseFloat(ask.size);

    if (sharesMatched >= sharesToBuy) {
      return Number.parseFloat(ask.price);
    }
  }

  if (orderType === OrderType.FOK) {
    throw new Error("no match");
  }

  return Number.parseFloat(orderBook.asks[0].price);
};

const calculateBuyOrderAmount = (shares: number, limitPrice: number) =>
  normalizePositiveNumber(
    Number.parseFloat((shares * limitPrice).toPrecision(12)),
    "amount",
  );

const normalizeSide = (value: string) => {
  const side = value.trim().toUpperCase();

  if (side !== "BUY" && side !== "SELL") {
    throw new ValidationError("`side` must be either `BUY` or `SELL`.");
  }

  return side;
};

const compareAvailableAmount = (available: string, required: number) =>
  Number.parseFloat(available) >= required;

const parseAvailableAmount = (value: string, label: string) => {
  const amount = Number.parseFloat(value);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new UpstreamError(`Polymarket returned an invalid ${label} amount.`);
  }

  return amount;
};

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
  amount: number,
  limitPrice: number,
) =>
  db
    .update(polymarketTradeAttempts)
    .set({
      amount: String(amount),
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
    const marketOrderType = OrderType.FOK;
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

    const minimumShares = normalizeStoredAmount(market.orderMinSize);
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
          amount: String(minimumShares),
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
      let amount = minimumShares;
      let limitPrice: number;

      if (side === "BUY") {
        const orderBook = await client.getOrderBook(outcome.tokenId);
        limitPrice = calculateBuyMarketPriceForShares(
          orderBook,
          minimumShares,
          marketOrderType,
        );
        amount = calculateBuyOrderAmount(minimumShares, limitPrice);
      }

      const balanceParams =
        side === "BUY"
          ? { asset_type: AssetType.COLLATERAL }
          : { asset_type: AssetType.CONDITIONAL, token_id: outcome.tokenId };
      const balance = await client.getBalanceAllowance(balanceParams);

      if (side === "SELL") {
        const availableShares = parseAvailableAmount(balance.balance, "share balance");

        if (availableShares <= 0) {
          throw new ValidationError("Insufficient balance for the requested trade.");
        }

        amount = Math.min(amount, availableShares);
        limitPrice = await client.calculateMarketPrice(
          outcome.tokenId,
          orderSide,
          amount,
          marketOrderType,
        );
      }

      if (side === "BUY" && !compareAvailableAmount(balance.balance, amount)) {
        throw new ValidationError("Insufficient balance for the requested trade.");
      }
      updateTradeAttemptPrepared(db, attemptId, amount, limitPrice);

      const response = await client.createAndPostMarketOrder(
        {
          tokenID: outcome.tokenId,
          price: limitPrice,
          amount,
          side: orderSide,
          orderType: marketOrderType,
        },
        {
          tickSize: market.tickSize as "0.1" | "0.01" | "0.001" | "0.0001",
          negRisk: market.negRisk,
        },
        marketOrderType,
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
