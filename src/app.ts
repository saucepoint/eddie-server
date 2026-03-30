import { Hono, type Context } from "hono";
import {
  createPolymarketIndexService,
  type FetchMarketBySlug,
  type GetTokenTradingMeta,
} from "./polymarket/indexing";
import {
  loadMarketRuntimeConfig,
  type MarketRuntimeConfig,
  type TradeRuntimeConfig,
} from "./polymarket/config";
import {
  createPolymarketTradeService,
  type BuildTradingClient,
} from "./polymarket/trading";
import {
  createGetUserPreferenceService,
  createUpsertUserPreferenceService,
  type PreferenceValue,
} from "./users/preferences";
import { createUserService, type CreateUserServiceDeps } from "./users/service";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPreferenceValue = (value: unknown): value is PreferenceValue => {
  if (value === null) {
    return false;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isPreferenceValue);
  }

  if (isRecord(value)) {
    return Object.values(value).every(isPreferenceValue);
  }

  return false;
};

type CreateAppDeps = CreateUserServiceDeps & {
  loadPolymarketMarketConfig?: () => MarketRuntimeConfig;
  fetchMarketBySlug?: FetchMarketBySlug;
  getTokenTradingMeta?: GetTokenTradingMeta;
  loadPolymarketTradeConfig?: () => TradeRuntimeConfig;
  buildTradingClient?: BuildTradingClient;
};

const handleAppError = (error: unknown, c: Context) => {
  if (error instanceof Error && "status" in error) {
    const status = Number(error.status);
    return c.json({ error: error.message }, status as never);
  }

  console.error(error);
  return c.json({ error: "Internal server error" }, 500);
};

export const createApp = (deps: CreateAppDeps = {}) => {
  const app = new Hono();
  const createUser = createUserService(deps);
  const upsertUserPreference = createUpsertUserPreferenceService({ db: deps.db });
  const getUserPreference = createGetUserPreferenceService({ db: deps.db });
  const indexPolymarketMarket = createPolymarketIndexService({
    db: deps.db,
    loadConfig: deps.loadPolymarketMarketConfig ?? loadMarketRuntimeConfig,
    fetchMarketBySlug: deps.fetchMarketBySlug,
    getTokenTradingMeta: deps.getTokenTradingMeta,
  });
  const tradePolymarketMarket = createPolymarketTradeService({
    db: deps.db,
    loadConfig: deps.loadPolymarketTradeConfig,
    buildTradingClient: deps.buildTradingClient,
  });

  app.get("/", c => c.json({ status: "ok" }));

  app.post("/user", async c => {
    let payload: unknown;

    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON." }, 400);
    }

    if (!isRecord(payload)) {
      return c.json(
        {
          error:
            "`clerkUserId`, `username`, and `phoneNumber` are required non-empty strings.",
        },
        400,
      );
    }

    const clerkUserId =
      typeof payload.clerkUserId === "string" ? payload.clerkUserId.trim() : "";
    const username =
      typeof payload.username === "string" ? payload.username.trim() : "";
    const phoneNumber =
      typeof payload.phoneNumber === "string" ? payload.phoneNumber.trim() : "";

    if (!clerkUserId || !username || !phoneNumber) {
      return c.json(
        {
          error:
            "`clerkUserId`, `username`, and `phoneNumber` are required non-empty strings.",
        },
        400,
      );
    }

    try {
      const result = await createUser({
        clerkUserId,
        username,
        phoneNumber,
      });

      return c.json(result, result.created ? 201 : 200);
    } catch (error) {
      return handleAppError(error, c);
    }
  });

  app.put("/user/preferences", async c => {
    let payload: unknown;

    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON." }, 400);
    }

    if (!isRecord(payload)) {
      return c.json(
        {
          error:
            "`clerkUserId` and `topic` are required non-empty strings, and `value` must be a non-null JSON value.",
        },
        400,
      );
    }

    const clerkUserId =
      typeof payload.clerkUserId === "string" ? payload.clerkUserId.trim() : "";
    const topic = typeof payload.topic === "string" ? payload.topic.trim() : "";
    const hasValue = Object.prototype.hasOwnProperty.call(payload, "value");

    if (!clerkUserId || !topic || !hasValue || !isPreferenceValue(payload.value)) {
      return c.json(
        {
          error:
            "`clerkUserId` and `topic` are required non-empty strings, and `value` must be a non-null JSON value.",
        },
        400,
      );
    }

    try {
      const result = await upsertUserPreference({
        clerkUserId,
        topic,
        value: payload.value,
      });

      return c.json(result, result.created ? 201 : 200);
    } catch (error) {
      return handleAppError(error, c);
    }
  });

  app.get("/user/preferences", async c => {
    const clerkUserId = c.req.query("clerkUserId")?.trim() ?? "";
    const topic = c.req.query("topic")?.trim() ?? "";

    if (!clerkUserId || !topic) {
      return c.json(
        {
          error: "`clerkUserId` and `topic` query params are required non-empty strings.",
        },
        400,
      );
    }

    try {
      const preference = await getUserPreference({ clerkUserId, topic });
      return c.json({ preference }, 200);
    } catch (error) {
      return handleAppError(error, c);
    }
  });

  app.post("/polymarket/index", async c => {
    let payload: unknown;

    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON." }, 400);
    }

    if (!isRecord(payload) || typeof payload.market !== "string") {
      return c.json(
        { error: "`market` is required and must be a non-empty string." },
        400,
      );
    }

    try {
      const config = (deps.loadPolymarketMarketConfig ?? loadMarketRuntimeConfig)();
      const headerSecret = c.req.header("x-polymarket-test-secret")?.trim() ?? "";

      if (headerSecret !== config.testEndpointSecret) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const result = await indexPolymarketMarket({ market: payload.market });
      return c.json(result, 200);
    } catch (error) {
      return handleAppError(error, c);
    }
  });

  app.post("/polymarket/trade", async c => {
    let payload: unknown;

    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON." }, 400);
    }

    if (
      !isRecord(payload) ||
      typeof payload.market !== "string" ||
      typeof payload.outcome !== "string" ||
      (payload.side !== "BUY" && payload.side !== "SELL")
    ) {
      return c.json(
        {
          error:
            "`market` and `outcome` must be strings, and `side` must be `BUY` or `SELL`.",
        },
        400,
      );
    }

    try {
      const config = (deps.loadPolymarketMarketConfig ?? loadMarketRuntimeConfig)();
      const headerSecret = c.req.header("x-polymarket-test-secret")?.trim() ?? "";

      if (headerSecret !== config.testEndpointSecret) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const result = await tradePolymarketMarket({
        market: payload.market,
        outcome: payload.outcome,
        side: payload.side,
      });

      return c.json(result, 200);
    } catch (error) {
      return handleAppError(error, c);
    }
  });

  app.notFound(c => c.json({ error: "Not found" }, 404));

  return app;
};
