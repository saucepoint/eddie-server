import { describe, expect, test } from "bun:test";
import { SignatureType, type ApiKeyCreds } from "@polymarket/clob-client";
import { polygon } from "viem/chains";
import type { WalletClient } from "viem";
import { encryptPrivateKey, resolveEncryptionKey } from "../crypto/encryption";
import { createDatabaseClient } from "../db/client";
import {
  polymarketMarkets,
  polymarketTradeAttempts,
  users,
} from "../db/schema";
import { UpstreamError } from "../errors";
import type { TradeRuntimeConfig } from "./config";
import {
  createPolymarketTradeService,
  createTradeClient,
  resolveTradeApiCreds,
} from "./trading";

const encryptionKey = resolveEncryptionKey("12345678901234567890123456789012");

const tradeConfig: TradeRuntimeConfig = {
  chainId: 137,
  chain: polygon,
  gammaHost: "https://gamma-api.polymarket.com",
  clobHost: "https://clob.polymarket.com",
  rpcUrl: "https://polygon-rpc.com",
  builderApiKey: "builder-key",
  builderSecret: "builder-secret",
  builderPassphrase: "builder-passphrase",
  encryptionKey,
  testEndpointSecret: "test-secret",
  liveTradingEnabled: true,
};

const privateKey =
  "0xabc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd";

const safeAddress = "0x2222222222222222222222222222222222222222";

const createStubWalletClient = () =>
  ({
    account: {
      address: "0x1111111111111111111111111111111111111111",
    },
  }) as WalletClient;

const seedUser = (db: ReturnType<typeof createDatabaseClient>["db"]) => {
  db.insert(users)
    .values({
      clerkUserId: "user_123",
      username: "alice",
      phoneNumber: "555-0101",
      encryptedPrivateKey: encryptPrivateKey(privateKey, encryptionKey),
      walletAddress: "0x1111111111111111111111111111111111111111",
      safeAddress,
      safeDeploymentTransactionId: "deploy-1",
      safeDeploymentTransactionHash:
        "0x3333333333333333333333333333333333333333333333333333333333333333",
      approvalTransactionId: "approval-1",
      approvalTransactionHash:
        "0x4444444444444444444444444444444444444444444444444444444444444444",
    })
    .run();
};

const seedIndexedMarket = (db: ReturnType<typeof createDatabaseClient>["db"]) => {
  db.insert(polymarketMarkets)
    .values({
      slug: "will-it-rain",
      conditionId: "condition-1",
      question: "Will it rain tomorrow?",
      outcomesJson: JSON.stringify(["YES", "NO"]),
      tokenIdsJson: JSON.stringify(["token-yes", "token-no"]),
      tickSize: "0.01",
      negRisk: false,
      orderMinSize: "5",
      enableOrderBook: true,
      acceptingOrders: true,
      active: true,
      closed: false,
      sourceUpdatedAt: "2026-03-29T00:00:00.000Z",
      indexedAt: "2026-03-29T00:00:00.000Z",
    })
    .run();
};

describe("resolveTradeApiCreds", () => {
  test("derives an existing API key before attempting creation", async () => {
    const walletClient = createStubWalletClient();
    const creds: ApiKeyCreds = {
      key: "user-key",
      secret: "user-secret",
      passphrase: "user-passphrase",
    };
    let createCalls = 0;

    const result = await resolveTradeApiCreds({
      config: tradeConfig,
      walletClient,
      createApiCredentialClient: () => ({
        deriveApiKey: async () => creds,
        createApiKey: async () => {
          createCalls += 1;
          return creds;
        },
      }),
    });

    expect(result).toEqual(creds);
    expect(createCalls).toBe(0);
  });

  test("falls back to creating an API key when derivation fails", async () => {
    const walletClient = createStubWalletClient();
    const createdCreds: ApiKeyCreds = {
      key: "created-key",
      secret: "created-secret",
      passphrase: "created-passphrase",
    };
    let deriveCalls = 0;

    const result = await resolveTradeApiCreds({
      config: tradeConfig,
      walletClient,
      createApiCredentialClient: () => ({
        deriveApiKey: async () => {
          deriveCalls += 1;
          throw new Error("missing api key");
        },
        createApiKey: async () => createdCreds,
      }),
    });

    expect(deriveCalls).toBe(1);
    expect(result).toEqual(createdCreds);
  });
});

describe("createTradeClient", () => {
  test("uses user API creds for the final authenticated client", async () => {
    const walletClient = createStubWalletClient();
    const userCreds: ApiKeyCreds = {
      key: "user-key",
      secret: "user-secret",
      passphrase: "user-passphrase",
    };
    const tradingClient = {
      getBalanceAllowance: async () => ({ balance: "100", allowance: "100" }),
      getOrderBook: async () => ({
        market: "will-it-rain",
        asset_id: "token-yes",
        timestamp: "2026-03-29T00:00:00.000Z",
        bids: [],
        asks: [{ price: "0.55", size: "5" }],
        min_order_size: "5",
        tick_size: "0.01",
        neg_risk: false,
        last_trade_price: "0.55",
        hash: "book-hash",
      }),
      calculateMarketPrice: async () => 0.55,
      createAndPostMarketOrder: async () => ({ success: true }),
    };
    let capturedArgs:
      | {
          apiCreds: ApiKeyCreds;
          signatureType: SignatureType;
          safeAddress: string;
          builderConfig: { isValid: () => boolean };
        }
      | undefined;

    const result = await createTradeClient(
      {
        config: tradeConfig,
        privateKey,
        safeAddress,
      },
      {
        createWalletClientImpl: () => walletClient,
        createApiCredentialClient: () => ({
          deriveApiKey: async () => userCreds,
          createApiKey: async () => {
            throw new Error("createApiKey should not be called");
          },
        }),
        createAuthenticatedClient: args => {
          capturedArgs = {
            apiCreds: args.apiCreds,
            signatureType: args.signatureType,
            safeAddress: args.safeAddress,
            builderConfig: args.builderConfig,
          };

          return tradingClient;
        },
      },
    );

    expect(result).toBe(tradingClient);
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs?.apiCreds).toEqual(userCreds);
    expect(capturedArgs?.apiCreds).not.toEqual({
      key: tradeConfig.builderApiKey,
      secret: tradeConfig.builderSecret,
      passphrase: tradeConfig.builderPassphrase,
    });
    expect(capturedArgs?.signatureType).toBe(SignatureType.POLY_GNOSIS_SAFE);
    expect(capturedArgs?.safeAddress).toBe(safeAddress);
    expect(capturedArgs?.builderConfig.isValid()).toBe(true);
  });

  test("wraps credential bootstrap failures as upstream errors", async () => {
    const walletClient = createStubWalletClient();

    await expect(
      createTradeClient(
        {
          config: tradeConfig,
          privateKey,
          safeAddress,
        },
        {
          createWalletClientImpl: () => walletClient,
          createApiCredentialClient: () => ({
            deriveApiKey: async () => {
              throw new Error("derive failed");
            },
            createApiKey: async () => {
              throw new Error("create failed");
            },
          }),
        },
      ),
    ).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("createPolymarketTradeService", () => {
  test("persists failed attempts when trade-client initialization fails", async () => {
    const client = createDatabaseClient(":memory:");
    const { db, sqlite } = client;

    seedUser(db);
    seedIndexedMarket(db);

    const trade = createPolymarketTradeService({
      db,
      loadConfig: () => tradeConfig,
      buildTradingClient: async () => {
        throw new UpstreamError("Failed to initialize the Polymarket trading client.");
      },
    });

    await expect(
      trade({
        market: "will-it-rain",
        outcome: "YES",
        side: "BUY",
      }),
    ).rejects.toBeInstanceOf(UpstreamError);

    const attempts = db.select().from(polymarketTradeAttempts).all();

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("failed");
    expect(attempts[0]?.errorMessage).toBe(
      "Failed to initialize the Polymarket trading client.",
    );

    await sqlite.close();
  });

  test("uses orderMinSize as shares for buy orders", async () => {
    const client = createDatabaseClient(":memory:");
    const { db, sqlite } = client;

    seedUser(db);
    seedIndexedMarket(db);

    let capturedOrder:
      | {
          tokenID: string;
          price: number;
          amount: number;
          side: string;
          orderType: string;
        }
      | undefined;
    let calculateMarketPriceCalls = 0;

    const trade = createPolymarketTradeService({
      db,
      loadConfig: () => tradeConfig,
      buildTradingClient: async () => ({
        getBalanceAllowance: async () => ({ balance: "10", allowance: "10" }),
        getOrderBook: async () => ({
          market: "will-it-rain",
          asset_id: "token-yes",
          timestamp: "2026-03-29T00:00:00.000Z",
          bids: [],
          asks: [{ price: "0.55", size: "5" }],
          min_order_size: "5",
          tick_size: "0.01",
          neg_risk: false,
          last_trade_price: "0.55",
          hash: "book-hash",
        }),
        calculateMarketPrice: async () => {
          calculateMarketPriceCalls += 1;
          return 0.99;
        },
        createAndPostMarketOrder: async order => {
          capturedOrder = order;

          return {
            success: true,
            orderID: "order-1",
            status: "live",
            transactionsHashes: ["0xtradehash"],
          };
        },
      }),
    });

    const result = await trade({
      market: "will-it-rain",
      outcome: "YES",
      side: "BUY",
    });
    const attempts = db.select().from(polymarketTradeAttempts).all();

    expect(calculateMarketPriceCalls).toBe(0);
    expect(result.amount).toBe(2.75);
    expect(result.limitPrice).toBe(0.55);
    expect(capturedOrder).toMatchObject({
      tokenID: "token-yes",
      price: 0.55,
      amount: 2.75,
      side: "BUY",
      orderType: "FOK",
    });
    expect(attempts[0]?.amount).toBe("2.75");

    await sqlite.close();
  });

  test("caps sell orders to the available share balance", async () => {
    const client = createDatabaseClient(":memory:");
    const { db, sqlite } = client;

    seedUser(db);
    seedIndexedMarket(db);

    let capturedOrder:
      | {
          tokenID: string;
          price: number;
          amount: number;
          side: string;
          orderType: string;
        }
      | undefined;

    const trade = createPolymarketTradeService({
      db,
      loadConfig: () => tradeConfig,
      buildTradingClient: async () => ({
        getBalanceAllowance: async () => ({ balance: "3", allowance: "3" }),
        getOrderBook: async () => ({
          market: "will-it-rain",
          asset_id: "token-yes",
          timestamp: "2026-03-29T00:00:00.000Z",
          bids: [{ price: "0.42", size: "3" }],
          asks: [],
          min_order_size: "5",
          tick_size: "0.01",
          neg_risk: false,
          last_trade_price: "0.42",
          hash: "book-hash",
        }),
        calculateMarketPrice: async (_tokenId, _side, amount) => {
          expect(amount).toBe(3);
          return 0.42;
        },
        createAndPostMarketOrder: async order => {
          capturedOrder = order;

          return {
            success: true,
            orderID: "sell-order-1",
            status: "live",
            transactionsHashes: ["0xsellhash"],
          };
        },
      }),
    });

    const result = await trade({
      market: "will-it-rain",
      outcome: "YES",
      side: "SELL",
    });
    const attempts = db.select().from(polymarketTradeAttempts).all();

    expect(result.amount).toBe(3);
    expect(result.limitPrice).toBe(0.42);
    expect(capturedOrder).toMatchObject({
      tokenID: "token-yes",
      price: 0.42,
      amount: 3,
      side: "SELL",
      orderType: "FOK",
    });
    expect(attempts[0]?.amount).toBe("3");

    await sqlite.close();
  });
});
