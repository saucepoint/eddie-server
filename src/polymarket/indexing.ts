import { and, asc, eq, or } from "drizzle-orm";
import { ClobClient } from "@polymarket/clob-client";
import { getDb, type AppDatabase } from "../db/client";
import { polymarketMarkets } from "../db/schema";
import { DatabaseError, NotFoundError, UpstreamError, ValidationError } from "../errors";
import {
  loadMarketRuntimeConfig,
  type MarketRuntimeConfig,
} from "./config";

type FetchImpl = typeof fetch;

type GammaMarket = Record<string, unknown>;

type MarketRow = typeof polymarketMarkets.$inferSelect;

export type IndexedMarketOutcome = {
  name: string;
  tokenId: string;
};

export type IndexedPolymarketMarket = {
  id: number;
  slug: string;
  conditionId: string;
  question: string;
  outcomes: IndexedMarketOutcome[];
  tickSize: string;
  negRisk: boolean;
  orderMinSize: string | null;
  enableOrderBook: boolean;
  acceptingOrders: boolean;
  active: boolean;
  closed: boolean;
  sourceUpdatedAt: string | null;
  indexedAt: string;
};

export type IndexPolymarketMarketInput = {
  market: string;
};

export type ListIndexedPolymarketMarketsInput = {
  active?: boolean;
  acceptingOrders?: boolean;
  closed?: boolean;
};

export type FetchMarketBySlug = (
  slug: string,
  config: MarketRuntimeConfig,
  fetchImpl: FetchImpl,
) => Promise<GammaMarket | null>;

export type GetTokenTradingMeta = (
  tokenId: string,
  config: MarketRuntimeConfig,
) => Promise<{ tickSize: string; negRisk: boolean }>;

export type CreatePolymarketIndexServiceDeps = {
  db?: AppDatabase;
  loadConfig?: () => MarketRuntimeConfig;
  fetchImpl?: FetchImpl;
  fetchMarketBySlug?: FetchMarketBySlug;
  getTokenTradingMeta?: GetTokenTradingMeta;
};

const getRequiredString = (value: unknown, label: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`Polymarket market ${label} is missing.`);
  }

  return value.trim();
};

const getOptionalString = (value: unknown) => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
};

const getBoolean = (value: unknown) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }

  return false;
};

const parseJsonStringArray = (value: unknown, label: string) => {
  const raw = getRequiredString(value, label);

  try {
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) {
      throw new Error("invalid");
    }

    return parsed.map(item => item.trim());
  } catch {
    throw new ValidationError(
      `Polymarket market ${label} must be a JSON string array.`,
    );
  }
};

const selectIndexedMarket = (db: AppDatabase, slug: string) =>
  db
    .select()
    .from(polymarketMarkets)
    .where(eq(polymarketMarkets.slug, slug))
    .get();

const selectIndexedMarketById = (db: AppDatabase, id: number) =>
  db
    .select()
    .from(polymarketMarkets)
    .where(eq(polymarketMarkets.id, id))
    .get();

const rowToIndexedMarket = (row: MarketRow): IndexedPolymarketMarket => {
  const outcomes = JSON.parse(row.outcomesJson) as string[];
  const tokenIds = JSON.parse(row.tokenIdsJson) as string[];

  return {
    id: row.id,
    slug: row.slug,
    conditionId: row.conditionId,
    question: row.question,
    outcomes: outcomes.map((name, index) => ({
      name,
      tokenId: tokenIds[index] ?? "",
    })),
    tickSize: row.tickSize,
    negRisk: row.negRisk,
    orderMinSize: row.orderMinSize,
    enableOrderBook: row.enableOrderBook,
    acceptingOrders: row.acceptingOrders,
    active: row.active,
    closed: row.closed,
    sourceUpdatedAt: row.sourceUpdatedAt,
    indexedAt: row.indexedAt,
  };
};

const createPublicClobClient = (config: MarketRuntimeConfig) =>
  new ClobClient(
    config.clobHost,
    config.chainId,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  );

export const normalizePolymarketSlug = (market: string) => {
  const trimmed = market.trim();

  if (!trimmed) {
    throw new ValidationError("`market` must be a non-empty string.");
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const slug = segments.at(-1);

  if (!slug) {
    throw new ValidationError("Polymarket URL must include a market slug.");
  }

  return slug;
};

export const fetchGammaMarketBySlug: FetchMarketBySlug = async (
  slug,
  config,
  fetchImpl,
) => {
  let response: Response;

  try {
    response = await fetchImpl(
      `${config.gammaHost}/markets/slug/${encodeURIComponent(slug)}`,
    );
  } catch (error) {
    throw new UpstreamError("Failed to reach the Polymarket Gamma API.", error);
  }

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new UpstreamError(
      `Polymarket Gamma API returned ${response.status} while indexing the market.`,
    );
  }

  try {
    return (await response.json()) as GammaMarket;
  } catch (error) {
    throw new UpstreamError("Polymarket Gamma API returned invalid JSON.", error);
  }
};

export const getTokenTradingMeta: GetTokenTradingMeta = async (
  tokenId,
  config,
) => {
  const client = createPublicClobClient(config);

  try {
    const [tickSize, negRisk] = await Promise.all([
      client.getTickSize(tokenId),
      client.getNegRisk(tokenId),
    ]);

    return { tickSize, negRisk };
  } catch (error) {
    throw new UpstreamError(
      "Failed to load Polymarket trading metadata from the CLOB API.",
      error,
    );
  }
};

export const createPolymarketIndexService = ({
  db: injectedDb,
  loadConfig = loadMarketRuntimeConfig,
  fetchImpl = fetch,
  fetchMarketBySlug = fetchGammaMarketBySlug,
  getTokenTradingMeta: getTradingMeta = getTokenTradingMeta,
}: CreatePolymarketIndexServiceDeps = {}) => {
  return async (
    input: IndexPolymarketMarketInput,
  ): Promise<IndexedPolymarketMarket> => {
    const db = injectedDb ?? getDb();
    const config = loadConfig();
    const slug = normalizePolymarketSlug(input.market);
    const market = await fetchMarketBySlug(slug, config, fetchImpl);

    if (!market) {
      throw new NotFoundError("Polymarket market not found.");
    }

    const question = getRequiredString(market.question, "question");
    const conditionId = getRequiredString(
      market.conditionId ?? market.condition_id,
      "conditionId",
    );
    const outcomes = parseJsonStringArray(market.outcomes, "outcomes");
    const tokenIds = parseJsonStringArray(
      market.clobTokenIds ?? market.clob_token_ids,
      "clobTokenIds",
    );

    if (outcomes.length === 0 || outcomes.length !== tokenIds.length) {
      throw new ValidationError(
        "Polymarket market outcomes and token IDs must be aligned arrays.",
      );
    }

    const tradingMeta = await getTradingMeta(tokenIds[0]!, config);
    const indexedAt = new Date().toISOString();
    const values = {
      slug,
      conditionId,
      question,
      outcomesJson: JSON.stringify(outcomes),
      tokenIdsJson: JSON.stringify(tokenIds),
      tickSize: tradingMeta.tickSize,
      negRisk: tradingMeta.negRisk,
      orderMinSize: getOptionalString(
        market.orderMinSize ?? market.minimum_order_size,
      ),
      enableOrderBook: getBoolean(
        market.enableOrderBook ?? market.enable_order_book,
      ),
      acceptingOrders: getBoolean(
        market.acceptingOrders ?? market.accepting_orders,
      ),
      active: getBoolean(market.active),
      closed: getBoolean(market.closed),
      sourceUpdatedAt: getOptionalString(
        market.updatedAt ?? market.updated_at,
      ),
      indexedAt,
    };

    try {
      const existing = db
        .select({ id: polymarketMarkets.id })
        .from(polymarketMarkets)
        .where(
          or(
            eq(polymarketMarkets.slug, slug),
            eq(polymarketMarkets.conditionId, conditionId),
          ),
        )
        .get();

      if (existing) {
        db.update(polymarketMarkets).set(values).where(eq(polymarketMarkets.id, existing.id)).run();
      } else {
        db.insert(polymarketMarkets).values(values).run();
      }

      const stored = selectIndexedMarket(db, slug);

      if (!stored) {
        throw new Error("Indexed market was not persisted.");
      }

      return rowToIndexedMarket(stored);
    } catch (error) {
      throw new DatabaseError("Failed to persist the indexed Polymarket market.", error);
    }
  };
};

export const getIndexedPolymarketMarketBySlug = (
  db: AppDatabase,
  slug: string,
) => {
  const row = selectIndexedMarket(db, slug);
  return row ? rowToIndexedMarket(row) : null;
};

export const getIndexedPolymarketMarketById = (
  db: AppDatabase,
  id: number,
) => {
  const row = selectIndexedMarketById(db, id);
  return row ? rowToIndexedMarket(row) : null;
};

export const createListIndexedPolymarketMarketsService = ({
  db: injectedDb,
}: Pick<CreatePolymarketIndexServiceDeps, "db"> = {}) => {
  return async (
    input: ListIndexedPolymarketMarketsInput = {},
  ): Promise<IndexedPolymarketMarket[]> => {
    const db = injectedDb ?? getDb();
    const conditions = [
      input.active === undefined
        ? undefined
        : eq(polymarketMarkets.active, input.active),
      input.acceptingOrders === undefined
        ? undefined
        : eq(polymarketMarkets.acceptingOrders, input.acceptingOrders),
      input.closed === undefined
        ? undefined
        : eq(polymarketMarkets.closed, input.closed),
    ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const query = db
      .select()
      .from(polymarketMarkets)
      .orderBy(asc(polymarketMarkets.id));
    const rows = (whereClause ? query.where(whereClause) : query).all();

    return rows.map(rowToIndexedMarket);
  };
};
