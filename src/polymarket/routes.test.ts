import { beforeEach, describe, expect, test } from "bun:test";
import { polygon } from "viem/chains";
import { createApp } from "../app";
import { encryptPrivateKey, resolveEncryptionKey } from "../crypto/encryption";
import { createDatabaseClient } from "../db/client";
import {
  polymarketMarkets,
  polymarketTradeAttempts,
  users,
} from "../db/schema";
import type { MarketRuntimeConfig, TradeRuntimeConfig } from "./config";

const encryptionKey = resolveEncryptionKey("12345678901234567890123456789012");

const marketConfig: MarketRuntimeConfig = {
  chainId: 137,
  chain: polygon,
  gammaHost: "https://gamma-api.polymarket.com",
  clobHost: "https://clob.polymarket.com",
  testEndpointSecret: "test-secret",
};

const tradeConfig: TradeRuntimeConfig = {
  ...marketConfig,
  rpcUrl: "https://polygon-rpc.com",
  builderApiKey: "builder-key",
  builderSecret: "builder-secret",
  builderPassphrase: "builder-passphrase",
  encryptionKey,
  liveTradingEnabled: true,
};

const createJsonRequest = (
  path: string,
  body: unknown,
  secret = marketConfig.testEndpointSecret,
) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-polymarket-test-secret": secret,
    },
    body: JSON.stringify(body),
  });

const seedUser = (
  db: ReturnType<typeof createDatabaseClient>["db"],
  overrides: Partial<typeof users.$inferInsert> = {},
) => {
  db.insert(users)
    .values({
      clerkUserId: "user_123",
      username: "alice",
      phoneNumber: "555-0101",
      encryptedPrivateKey: encryptPrivateKey(
        "0xabc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd",
        encryptionKey,
      ),
      walletAddress: "0x1111111111111111111111111111111111111111",
      safeAddress: "0x2222222222222222222222222222222222222222",
      safeDeploymentTransactionId: "deploy-1",
      safeDeploymentTransactionHash:
        "0x3333333333333333333333333333333333333333333333333333333333333333",
      approvalTransactionId: "approval-1",
      approvalTransactionHash:
        "0x4444444444444444444444444444444444444444444444444444444444444444",
      ...overrides,
    })
    .run();
};

const seedIndexedMarket = (
  db: ReturnType<typeof createDatabaseClient>["db"],
  overrides: Record<string, unknown> = {},
) => {
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
      ...overrides,
    })
    .run();
};

describe("Polymarket routes", () => {
  let sqlite: ReturnType<typeof createDatabaseClient>["sqlite"];
  let db: ReturnType<typeof createDatabaseClient>["db"];

  beforeEach(() => {
    const client = createDatabaseClient(":memory:");
    sqlite = client.sqlite;
    db = client.db;
  });

  test("POST /polymarket/index requires the shared secret", async () => {
    const app = createApp({
      db,
      loadPolymarketMarketConfig: () => marketConfig,
      fetchMarketBySlug: async () => ({
        question: "Will it rain tomorrow?",
        conditionId: "condition-1",
        outcomes: '["YES","NO"]',
        clobTokenIds: '["token-yes","token-no"]',
      }),
      getTokenTradingMeta: async () => ({ tickSize: "0.01", negRisk: false }),
    });

    const response = await app.request(
      createJsonRequest(
        "/polymarket/index",
        { market: "will-it-rain" },
        "wrong-secret",
      ),
    );

    expect(response.status).toBe(401);
    expect(db.select().from(polymarketMarkets).all()).toHaveLength(0);
    await sqlite.close();
  });

  test("POST /polymarket/index normalizes a URL and upserts the market", async () => {
    let version = 0;
    const app = createApp({
      db,
      loadPolymarketMarketConfig: () => marketConfig,
      fetchMarketBySlug: async slug => ({
        question:
          version === 0 ? "Will it rain tomorrow?" : "Will it rain this week?",
        conditionId: "condition-1",
        outcomes: '["YES","NO"]',
        clobTokenIds: '["token-yes","token-no"]',
        enableOrderBook: true,
        acceptingOrders: true,
        active: true,
        closed: false,
        orderMinSize: 5,
        updatedAt: "2026-03-29T00:00:00.000Z",
        slug,
      }),
      getTokenTradingMeta: async () => ({ tickSize: "0.01", negRisk: false }),
    });

    const firstResponse = await app.request(
      createJsonRequest("/polymarket/index", {
        market: "https://polymarket.com/event/will-it-rain",
      }),
    );
    version = 1;
    const secondResponse = await app.request(
      createJsonRequest("/polymarket/index", { market: "will-it-rain" }),
    );
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();
    const stored = db.select().from(polymarketMarkets).all();

    expect(firstResponse.status).toBe(200);
    expect(firstBody.slug).toBe("will-it-rain");
    expect(firstBody.outcomes).toEqual([
      { name: "YES", tokenId: "token-yes" },
      { name: "NO", tokenId: "token-no" },
    ]);
    expect(secondResponse.status).toBe(200);
    expect(secondBody.question).toBe("Will it rain this week?");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.question).toBe("Will it rain this week?");
    await sqlite.close();
  });

  test("POST /polymarket/trade executes a trade and persists the attempt", async () => {
    seedUser(db);
    seedUser(db, {
      clerkUserId: "user_999",
      phoneNumber: "555-0199",
      username: "zoe",
      encryptedPrivateKey: encryptPrivateKey(
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        encryptionKey,
      ),
      walletAddress: "0x9999999999999999999999999999999999999999",
      safeAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      safeDeploymentTransactionId: "deploy-2",
      safeDeploymentTransactionHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      approvalTransactionId: "approval-2",
      approvalTransactionHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    });
    seedIndexedMarket(db);

    let capturedPrivateKey = "";
    let capturedSafeAddress = "";
    let capturedTokenId = "";
    const app = createApp({
      db,
      loadPolymarketMarketConfig: () => marketConfig,
      loadPolymarketTradeConfig: () => tradeConfig,
      buildTradingClient: async ({ privateKey, safeAddress }) => {
        capturedPrivateKey = privateKey;
        capturedSafeAddress = safeAddress;

        return {
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
          createAndPostMarketOrder: async order => {
            capturedTokenId = order.tokenID;

            return {
              success: true,
              orderID: "order-1",
              status: "live",
              transactionsHashes: ["0xtradehash"],
            };
          },
        };
      },
    });

    const response = await app.request(
      createJsonRequest("/polymarket/trade", {
        market: "will-it-rain",
        outcome: "yes",
        side: "BUY",
      }),
    );
    const body = await response.json();
    const attempts = db.select().from(polymarketTradeAttempts).all();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      marketSlug: "will-it-rain",
      tokenId: "token-yes",
      amount: 2.75,
      limitPrice: 0.55,
      orderType: "FOK",
      orderId: "order-1",
      transactionHashes: ["0xtradehash"],
    });
    expect(capturedPrivateKey).toBe(
      "0xabc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd",
    );
    expect(capturedSafeAddress).toBe(
      "0x2222222222222222222222222222222222222222",
    );
    expect(capturedTokenId).toBe("token-yes");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("succeeded");
    expect(attempts[0]?.responseOrderId).toBe("order-1");
    await sqlite.close();
  });

  test("POST /polymarket/trade rejects live execution when disabled", async () => {
    seedUser(db);
    seedIndexedMarket(db);

    const app = createApp({
      db,
      loadPolymarketMarketConfig: () => marketConfig,
      loadPolymarketTradeConfig: () => ({
        ...tradeConfig,
        liveTradingEnabled: false,
      }),
    });

    const response = await app.request(
      createJsonRequest("/polymarket/trade", {
        market: "will-it-rain",
        outcome: "YES",
        side: "BUY",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: "Live Polymarket test trading is disabled.",
    });
    expect(db.select().from(polymarketTradeAttempts).all()).toHaveLength(0);
    await sqlite.close();
  });

  test("POST /polymarket/trade persists failed attempts", async () => {
    seedUser(db);
    seedIndexedMarket(db);

    const app = createApp({
      db,
      loadPolymarketMarketConfig: () => marketConfig,
      loadPolymarketTradeConfig: () => tradeConfig,
      buildTradingClient: async () => ({
        getBalanceAllowance: async () => ({ balance: "1", allowance: "1" }),
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
        createAndPostMarketOrder: async () => ({
          success: true,
          orderID: "order-should-not-exist",
          status: "live",
          transactionsHashes: [],
        }),
      }),
    });

    const response = await app.request(
      createJsonRequest("/polymarket/trade", {
        market: "will-it-rain",
        outcome: "YES",
        side: "BUY",
      }),
    );
    const body = await response.json();
    const attempts = db.select().from(polymarketTradeAttempts).all();

    expect(response.status).toBe(422);
    expect(body).toEqual({
      error: "Insufficient balance for the requested trade.",
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("failed");
    expect(attempts[0]?.errorMessage).toBe(
      "Insufficient balance for the requested trade.",
    );
    await sqlite.close();
  });

  test("POST /polymarket/trade caps sell orders to the available share balance", async () => {
    seedUser(db);
    seedIndexedMarket(db);

    let capturedAmount = 0;
    const app = createApp({
      db,
      loadPolymarketMarketConfig: () => marketConfig,
      loadPolymarketTradeConfig: () => tradeConfig,
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
          capturedAmount = amount;
          return 0.42;
        },
        createAndPostMarketOrder: async () => ({
          success: true,
          orderID: "sell-order-1",
          status: "live",
          transactionsHashes: ["0xsellhash"],
        }),
      }),
    });

    const response = await app.request(
      createJsonRequest("/polymarket/trade", {
        market: "will-it-rain",
        outcome: "YES",
        side: "SELL",
      }),
    );
    const body = await response.json();
    const attempts = db.select().from(polymarketTradeAttempts).all();

    expect(response.status).toBe(200);
    expect(capturedAmount).toBe(3);
    expect(body).toMatchObject({
      marketSlug: "will-it-rain",
      tokenId: "token-yes",
      amount: 3,
      limitPrice: 0.42,
      orderType: "FOK",
      orderId: "sell-order-1",
      transactionHashes: ["0xsellhash"],
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.amount).toBe("3");

    await sqlite.close();
  });

  test("fresh migrations include the new Polymarket tables", async () => {
    const tables = sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    expect(tables.map(table => table.name)).toEqual(
      expect.arrayContaining([
        "users",
        "polymarket_markets",
        "polymarket_trade_attempts",
      ]),
    );
    await sqlite.close();
  });
});
