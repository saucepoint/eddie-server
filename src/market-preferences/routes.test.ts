import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../app";
import { createDatabaseClient } from "../db/client";
import {
  marketPreferences,
  polymarketMarkets,
  users,
} from "../db/schema";

const createUserPreferenceRequest = (body: unknown) =>
  new Request("http://localhost/user/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const createMarketPreferenceRequest = (body: unknown) =>
  new Request("http://localhost/market/preferences", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const createUpdateMarketPreferenceRequest = (id: number, body: unknown) =>
  new Request(`http://localhost/market/preferences/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const createDeleteMarketPreferenceRequest = (id: number) =>
  new Request(`http://localhost/market/preferences/${id}`, {
    method: "DELETE",
  });

const createGetMarketPreferenceRequest = (id: number) =>
  new Request(`http://localhost/market/preferences/${id}`);

const createListMarketPreferencesRequest = (params: Record<string, string>) =>
  new Request(
    `http://localhost/market/preferences?${new URLSearchParams(params).toString()}`,
  );

const createListMarketsRequest = (params?: Record<string, string>) =>
  new Request(
    `http://localhost/polymarket/markets${params ? `?${new URLSearchParams(params).toString()}` : ""}`,
  );

const seedUser = (
  db: ReturnType<typeof createDatabaseClient>["db"],
  overrides: Partial<typeof users.$inferInsert> = {},
) => {
  db.insert(users)
    .values({
      clerkUserId: "user_123",
      username: "alice",
      phoneNumber: "555-0101",
      encryptedPrivateKey: "encrypted",
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

describe("Market preference routes", () => {
  let sqlite: ReturnType<typeof createDatabaseClient>["sqlite"];
  let db: ReturnType<typeof createDatabaseClient>["db"];

  beforeEach(() => {
    const client = createDatabaseClient(":memory:");
    sqlite = client.sqlite;
    db = client.db;
  });

  afterEach(async () => {
    await sqlite.close();
  });

  test("GET /polymarket/markets lists indexed markets and applies boolean filters", async () => {
    seedIndexedMarket(db);
    seedIndexedMarket(db, {
      slug: "will-stock-rise",
      conditionId: "condition-2",
      question: "Will the stock rise?",
      active: false,
      acceptingOrders: false,
      closed: true,
    });

    const app = createApp({ db });
    const response = await app.request(
      createListMarketsRequest({
        active: "true",
        acceptingOrders: "true",
        closed: "false",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      markets: [
        {
          id: 1,
          slug: "will-it-rain",
          conditionId: "condition-1",
          question: "Will it rain tomorrow?",
          outcomes: [
            { name: "YES", tokenId: "token-yes" },
            { name: "NO", tokenId: "token-no" },
          ],
          tickSize: "0.01",
          negRisk: false,
          orderMinSize: "5",
          enableOrderBook: true,
          acceptingOrders: true,
          active: true,
          closed: false,
          sourceUpdatedAt: "2026-03-29T00:00:00.000Z",
          indexedAt: "2026-03-29T00:00:00.000Z",
        },
      ],
    });
  });

  test("POST, GET, PUT, and DELETE /market/preferences manage hedge associations", async () => {
    seedUser(db);
    seedIndexedMarket(db);
    const app = createApp({ db });
    const preferenceResponse = await app.request(
      createUserPreferenceRequest({
        clerkUserId: "user_123",
        topic: "cityId",
        value: "boston-ma",
      }),
    );
    const preferenceBody = await preferenceResponse.json();
    const userPreferenceId = preferenceBody.preference.id as number;

    const createResponse = await app.request(
      createMarketPreferenceRequest({
        userPreferenceId,
        polymarketMarketId: 1,
        rank: 1,
        rationale: "Rain exposure can offset the city's weather sensitivity.",
        hedgeOutcome: "NO",
        hedgeTokenId: "token-no",
        hedgeSide: "BUY",
      }),
    );
    const createBody = await createResponse.json();
    const marketPreferenceId = createBody.marketPreference.id as number;
    const listResponse = await app.request(
      createListMarketPreferencesRequest({ clerkUserId: "user_123" }),
    );
    const listBody = await listResponse.json();
    const getResponse = await app.request(
      createGetMarketPreferenceRequest(marketPreferenceId),
    );
    const getBody = await getResponse.json();
    const updateResponse = await app.request(
      createUpdateMarketPreferenceRequest(marketPreferenceId, {
        rank: 2,
        rationale: "Updated hedge rationale.",
        hedgeOutcome: "YES",
        hedgeTokenId: "token-yes",
        hedgeSide: "SELL",
      }),
    );
    const updateBody = await updateResponse.json();
    const deleteResponse = await app.request(
      createDeleteMarketPreferenceRequest(marketPreferenceId),
    );

    expect(createResponse.status).toBe(201);
    expect(createBody.marketPreference).toMatchObject({
      id: expect.any(Number),
      userPreferenceId,
      polymarketMarketId: 1,
      rank: 1,
      rationale: "Rain exposure can offset the city's weather sensitivity.",
      hedgeOutcome: "NO",
      hedgeTokenId: "token-no",
      hedgeSide: "BUY",
      userPreference: {
        id: userPreferenceId,
        clerkUserId: "user_123",
        topic: "cityid",
        value: "boston-ma",
        marketPreferenceEligible: true,
      },
      polymarketMarket: {
        id: 1,
        slug: "will-it-rain",
        question: "Will it rain tomorrow?",
      },
    });
    expect(listResponse.status).toBe(200);
    expect(listBody.marketPreferences).toHaveLength(1);
    expect(listBody.marketPreferences[0]).toMatchObject({
      id: marketPreferenceId,
      rank: 1,
      hedgeOutcome: "NO",
      hedgeTokenId: "token-no",
      hedgeSide: "BUY",
    });
    expect(getResponse.status).toBe(200);
    expect(getBody.marketPreference).toMatchObject({
      id: marketPreferenceId,
      hedgeOutcome: "NO",
      hedgeTokenId: "token-no",
      hedgeSide: "BUY",
    });
    expect(updateResponse.status).toBe(200);
    expect(updateBody.marketPreference).toMatchObject({
      id: marketPreferenceId,
      rank: 2,
      rationale: "Updated hedge rationale.",
      hedgeOutcome: "YES",
      hedgeTokenId: "token-yes",
      hedgeSide: "SELL",
    });
    expect(deleteResponse.status).toBe(204);
    expect(db.select().from(marketPreferences).all()).toHaveLength(0);
  });

  test("POST /market/preferences returns 409 for a duplicate user-preference market pair", async () => {
    seedUser(db);
    seedIndexedMarket(db);
    const app = createApp({ db });
    const preferenceResponse = await app.request(
      createUserPreferenceRequest({
        clerkUserId: "user_123",
        topic: "positionSize",
        value: 4,
      }),
    );
    const preferenceBody = await preferenceResponse.json();

    await app.request(
      createMarketPreferenceRequest({
        userPreferenceId: preferenceBody.preference.id,
        polymarketMarketId: 1,
        rank: 1,
        rationale: "Initial hedge.",
        hedgeOutcome: "NO",
        hedgeTokenId: "token-no",
        hedgeSide: "BUY",
      }),
    );

    const response = await app.request(
      createMarketPreferenceRequest({
        userPreferenceId: preferenceBody.preference.id,
        polymarketMarketId: 1,
        rank: 2,
        rationale: "Duplicate hedge.",
        hedgeOutcome: "NO",
        hedgeTokenId: "token-no",
        hedgeSide: "BUY",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "A market preference for that user preference and market already exists.",
    });
  });

  test("PUT /market/preferences/:id rejects attempts to change linked IDs", async () => {
    const app = createApp({ db });
    const response = await app.request(
      createUpdateMarketPreferenceRequest(1, {
        userPreferenceId: 2,
        rank: 1,
        rationale: "Invalid update.",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error:
        "`rank` must be a positive integer, `rationale` must be a non-empty string, linked IDs cannot be updated, and hedge fields must be supplied together with `hedgeSide` set to `BUY` or `SELL`.",
    });
  });

  test("POST /market/preferences rejects mismatched hedge outcome and token pairs", async () => {
    seedUser(db);
    seedIndexedMarket(db);
    const app = createApp({ db });
    const preferenceResponse = await app.request(
      createUserPreferenceRequest({
        clerkUserId: "user_123",
        topic: "cityId",
        value: "boston-ma",
      }),
    );
    const preferenceBody = await preferenceResponse.json();

    const response = await app.request(
      createMarketPreferenceRequest({
        userPreferenceId: preferenceBody.preference.id,
        polymarketMarketId: 1,
        rank: 1,
        rationale: "Bad hedge selection.",
        hedgeOutcome: "YES",
        hedgeTokenId: "token-no",
        hedgeSide: "BUY",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toEqual({
      error:
        "`hedgeOutcome` and `hedgeTokenId` must match the same indexed Polymarket market outcome.",
    });
  });

  test("PUT /market/preferences rejects partial hedge updates", async () => {
    const app = createApp({ db });
    const response = await app.request(
      createUpdateMarketPreferenceRequest(1, {
        rank: 1,
        rationale: "Invalid update.",
        hedgeOutcome: "NO",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error:
        "`rank` must be a positive integer, `rationale` must be a non-empty string, linked IDs cannot be updated, and hedge fields must be supplied together with `hedgeSide` set to `BUY` or `SELL`.",
    });
  });

  test("fresh migrations include the market_preferences table", () => {
    const tables = sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const columns = sqlite
      .query("PRAGMA table_info('market_preferences')")
      .all() as Array<{ name: string }>;

    expect(tables.map(table => table.name)).toEqual(
      expect.arrayContaining([
        "users",
        "user_preferences",
        "polymarket_markets",
        "market_preferences",
      ]),
    );
    expect(columns.map(column => column.name)).toEqual(
      expect.arrayContaining([
        "hedge_outcome",
        "hedge_token_id",
        "hedge_side",
      ]),
    );
  });
});
