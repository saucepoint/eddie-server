import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createApp } from "../app";
import { createDatabaseClient } from "../db/client";
import { userPreferences, users } from "../db/schema";

const createPreferenceRequest = (body: unknown) =>
  new Request("http://localhost/user/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const createUserPreferenceQuery = (clerkUserId: string, topic: string) =>
  new Request(
    `http://localhost/user/preferences?clerkUserId=${encodeURIComponent(clerkUserId)}&topic=${encodeURIComponent(topic)}`,
  );

const createBatchPreferenceRequest = (body: unknown) =>
  new Request("http://localhost/user/preferences/batch", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const createBatchPreferenceQuery = ({
  clerkUserId,
  topics,
}: {
  clerkUserId: string;
  topics?: string[];
}) => {
  const params = new URLSearchParams({ clerkUserId });

  if (topics) {
    params.set("topics", topics.join(","));
  }

  return new Request(`http://localhost/user/preferences/batch?${params.toString()}`);
};

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

describe("User preference routes", () => {
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

  test("PUT /user/preferences returns 400 for malformed JSON", async () => {
    const app = createApp({ db });
    const response = await app.request(
      new Request("http://localhost/user/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{bad-json",
      }),
    );

    expect(response.status).toBe(400);
  });

  test("PUT /user/preferences returns 400 when required fields are invalid", async () => {
    const app = createApp({ db });
    const response = await app.request(
      createPreferenceRequest({
        clerkUserId: "user_123",
        topic: "",
        value: null,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error:
        "`clerkUserId` and `topic` are required non-empty strings, and `value` must be a non-null JSON value.",
    });
  });

  test("PUT /user/preferences returns 404 when the user does not exist", async () => {
    const app = createApp({ db });
    const response = await app.request(
      createPreferenceRequest({
        clerkUserId: "user_missing",
        topic: "sports teams",
        value: ["knicks", "jets"],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "User not found." });
  });

  test("PUT /user/preferences stores an array value and GET returns it", async () => {
    seedUser(db);

    const app = createApp({ db });
    const putResponse = await app.request(
      createPreferenceRequest({
        clerkUserId: "user_123",
        topic: " Sports Teams ",
        value: ["knicks", "jets"],
      }),
    );
    const putBody = await putResponse.json();
    const stored = db.select().from(userPreferences).get();
    const getResponse = await app.request(
      createUserPreferenceQuery("user_123", "SPORTS TEAMS"),
    );
    const getBody = await getResponse.json();

    expect(putResponse.status).toBe(201);
    expect(putBody).toEqual({
      created: true,
      preference: {
        id: expect.any(Number),
        clerkUserId: "user_123",
        topic: "sports teams",
        value: ["knicks", "jets"],
        marketPreferenceEligible: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });
    expect(stored?.topic).toBe("sports teams");
    expect(JSON.parse(stored!.valueJson)).toEqual(["knicks", "jets"]);
    expect(getResponse.status).toBe(200);
    expect(getBody).toEqual({
      preference: putBody.preference,
    });
  });

  test("PUT /user/preferences overwrites an existing topic", async () => {
    seedUser(db);

    const app = createApp({ db });
    const firstResponse = await app.request(
      createPreferenceRequest({
        clerkUserId: "user_123",
        topic: "city",
        value: {
          city: "Miami",
          preferredTemperatureF: 72,
        },
      }),
    );
    const firstBody = await firstResponse.json();

    await Bun.sleep(5);

    const secondResponse = await app.request(
      createPreferenceRequest({
        clerkUserId: "user_123",
        topic: "city",
        value: {
          city: "Chicago",
          preferredTemperatureF: 68,
        },
      }),
    );
    const secondBody = await secondResponse.json();
    const stored = db.select().from(userPreferences).all();

    expect(secondResponse.status).toBe(200);
    expect(secondBody).toEqual({
      created: false,
      preference: {
        id: firstBody.preference.id,
        clerkUserId: "user_123",
        topic: "city",
        value: {
          city: "Chicago",
          preferredTemperatureF: 68,
        },
        marketPreferenceEligible: true,
        createdAt: firstBody.preference.createdAt,
        updatedAt: expect.any(String),
      },
    });
    expect(secondBody.preference.updatedAt).not.toBe(firstBody.preference.updatedAt);
    expect(stored).toHaveLength(1);
    expect(JSON.parse(stored[0]!.valueJson)).toEqual({
      city: "Chicago",
      preferredTemperatureF: 68,
    });
  });

  test("different users can store the same topic without collisions", async () => {
    seedUser(db);
    seedUser(db, {
      clerkUserId: "user_999",
      username: "zoe",
      phoneNumber: "555-0199",
      walletAddress: "0x9999999999999999999999999999999999999999",
      safeAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      safeDeploymentTransactionId: "deploy-2",
      safeDeploymentTransactionHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      approvalTransactionId: "approval-2",
      approvalTransactionHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    });

    const app = createApp({ db });

    const firstResponse = await app.request(
      createPreferenceRequest({
        clerkUserId: "user_123",
        topic: "political ideology",
        value: "conservative",
      }),
    );
    const secondResponse = await app.request(
      createPreferenceRequest({
        clerkUserId: "user_999",
        topic: "political ideology",
        value: "moderate",
      }),
    );
    const firstGetResponse = await app.request(
      createUserPreferenceQuery("user_123", "political ideology"),
    );
    const secondGetResponse = await app.request(
      createUserPreferenceQuery("user_999", "political ideology"),
    );

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect((await firstGetResponse.json()).preference.value).toBe("conservative");
    expect((await secondGetResponse.json()).preference.value).toBe("moderate");
    expect(db.select().from(userPreferences).all()).toHaveLength(2);
  });

  test("GET /user/preferences returns 400 for missing params", async () => {
    const app = createApp({ db });
    const response = await app.request(
      new Request("http://localhost/user/preferences?clerkUserId=user_123"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "`clerkUserId` and `topic` query params are required non-empty strings.",
    });
  });

  test("GET /user/preferences returns 404 when the topic does not exist", async () => {
    seedUser(db);

    const app = createApp({ db });
    const response = await app.request(
      createUserPreferenceQuery("user_123", "crypto token"),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "User preference not found." });
  });

  test("PUT /user/preferences/batch stores and GET returns a topic map", async () => {
    seedUser(db);

    const app = createApp({ db });
    const putResponse = await app.request(
      createBatchPreferenceRequest({
        clerkUserId: "user_123",
        preferences: {
          favoriteTeamsByLeague: {
            nba: ["nba-knicks"],
            nhl: ["nhl-rangers"],
            mlb: ["mlb-yankees"],
          },
          cityId: "boston-ma",
          positionSize: 4,
        },
      }),
    );
    const putBody = await putResponse.json();
    const getResponse = await app.request(
      createBatchPreferenceQuery({
        clerkUserId: "user_123",
        topics: ["favoriteTeamsByLeague", "cityId", "positionSize"],
      }),
    );
    const getBody = await getResponse.json();

    expect(putResponse.status).toBe(200);
    expect(putBody).toEqual({
      preferences: {
        favoriteTeamsByLeague: {
          nba: ["nba-knicks"],
          nhl: ["nhl-rangers"],
          mlb: ["mlb-yankees"],
        },
        cityId: "boston-ma",
        positionSize: 4,
      },
      preferenceRecords: [
        {
          id: expect.any(Number),
          clerkUserId: "user_123",
          topic: "favoriteteamsbyleague",
          value: {
            nba: ["nba-knicks"],
            nhl: ["nhl-rangers"],
            mlb: ["mlb-yankees"],
          },
          marketPreferenceEligible: true,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
        {
          id: expect.any(Number),
          clerkUserId: "user_123",
          topic: "cityid",
          value: "boston-ma",
          marketPreferenceEligible: true,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
        {
          id: expect.any(Number),
          clerkUserId: "user_123",
          topic: "positionsize",
          value: 4,
          marketPreferenceEligible: true,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      ],
    });
    expect(getResponse.status).toBe(200);
    expect(getBody).toEqual(putBody);
  });

  test("PUT /user/preferences/batch updates existing topics and preserves one row per topic", async () => {
    seedUser(db);

    const app = createApp({ db });
    await app.request(
      createBatchPreferenceRequest({
        clerkUserId: "user_123",
        preferences: {
          cityId: "boston-ma",
          positionSize: 4,
        },
      }),
    );

    await Bun.sleep(5);

    const response = await app.request(
      createBatchPreferenceRequest({
        clerkUserId: "user_123",
        preferences: {
          cityId: "seattle-wa",
          positionSize: 8,
        },
      }),
    );
    const body = await response.json();
    const stored = db.select().from(userPreferences).all();

    expect(response.status).toBe(200);
    expect(body.preferences).toEqual({
      cityId: "seattle-wa",
      positionSize: 8,
    });
    expect(body.preferenceRecords).toHaveLength(2);
    expect(body.preferenceRecords.map((preference: { topic: string }) => preference.topic)).toEqual([
      "cityid",
      "positionsize",
    ]);
    expect(stored).toHaveLength(2);
    expect(stored.map(preference => preference.topic).sort()).toEqual([
      "cityid",
      "positionsize",
    ]);
  });

  test("PUT /user/preferences/batch returns 400 for invalid payloads", async () => {
    const app = createApp({ db });
    const response = await app.request(
      createBatchPreferenceRequest({
        clerkUserId: "user_123",
        preferences: {
          cityId: null,
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error:
        "`clerkUserId` is required, and `preferences` must be a non-empty object whose values are non-null JSON values.",
    });
  });

  test("GET /user/preferences/batch returns an empty map when the user has no saved preferences", async () => {
    seedUser(db);

    const app = createApp({ db });
    const response = await app.request(
      createBatchPreferenceQuery({
        clerkUserId: "user_123",
        topics: ["cityId", "positionSize"],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      preferences: {},
      preferenceRecords: [],
    });
  });

  test("coverageTier is stored on the user row instead of user_preferences", async () => {
    seedUser(db);

    const app = createApp({ db });
    const response = await app.request(
      createBatchPreferenceRequest({
        clerkUserId: "user_123",
        preferences: {
          coverageTier: "high",
          cityId: "boston-ma",
        },
      }),
    );
    const body = await response.json();
    const storedPreferences = db.select().from(userPreferences).all();
    const storedUser = db.select().from(users).where(eq(users.clerkUserId, "user_123")).get();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      preferences: {
        coverageTier: "high",
        cityId: "boston-ma",
      },
      preferenceRecords: [
        {
          id: null,
          clerkUserId: "user_123",
          topic: "coveragetier",
          value: "high",
          marketPreferenceEligible: false,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
        {
          id: expect.any(Number),
          clerkUserId: "user_123",
          topic: "cityid",
          value: "boston-ma",
          marketPreferenceEligible: true,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      ],
    });
    expect(storedUser?.coverageTier).toBe("high");
    expect(storedPreferences.map(preference => preference.topic)).toEqual([
      "cityid",
    ]);
  });

  test("fresh migrations include the user_preferences table", () => {
    const tables = sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    expect(tables.map(table => table.name)).toEqual(
      expect.arrayContaining(["users", "user_preferences"]),
    );
  });
});
