import { and, asc, eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "../db/client";
import {
  marketPreferences,
  polymarketMarkets,
  userPreferences,
  users,
} from "../db/schema";
import {
  ConflictError,
  DatabaseError,
  NotFoundError,
  ValidationError,
} from "../errors";
import type { IndexedPolymarketMarket } from "../polymarket/indexing";
import type { UserPreference } from "../users/preferences";

export type MarketPreference = {
  id: number;
  userPreferenceId: number;
  polymarketMarketId: number;
  rank: number;
  rationale: string;
  createdAt: string;
  updatedAt: string;
  userPreference: UserPreference & {
    id: number;
    marketPreferenceEligible: true;
  };
  polymarketMarket: IndexedPolymarketMarket;
};

export type CreateMarketPreferenceInput = {
  userPreferenceId: number;
  polymarketMarketId: number;
  rank: number;
  rationale: string;
};

export type UpdateMarketPreferenceInput = {
  id: number;
  rank: number;
  rationale: string;
};

export type GetMarketPreferenceInput = {
  id: number;
};

export type ListMarketPreferencesInput = {
  clerkUserId?: string;
  userPreferenceId?: number;
  polymarketMarketId?: number;
};

export type DeleteMarketPreferenceInput = {
  id: number;
};

export type MarketPreferenceServiceDeps = {
  db?: AppDatabase;
};

type JoinedMarketPreferenceRow = {
  id: number;
  userPreferenceId: number;
  polymarketMarketId: number;
  rank: number;
  rationale: string;
  createdAt: string;
  updatedAt: string;
  clerkUserId: string;
  preferenceTopic: string;
  preferenceValueJson: string;
  preferenceCreatedAt: string;
  preferenceUpdatedAt: string;
  marketSlug: string;
  marketConditionId: string;
  marketQuestion: string;
  marketOutcomesJson: string;
  marketTokenIdsJson: string;
  marketTickSize: string;
  marketNegRisk: boolean;
  marketOrderMinSize: string | null;
  marketEnableOrderBook: boolean;
  marketAcceptingOrders: boolean;
  marketActive: boolean;
  marketClosed: boolean;
  marketSourceUpdatedAt: string | null;
  marketIndexedAt: string;
};

const normalizePositiveInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`\`${label}\` must be a positive integer.`);
  }

  return value;
};

const normalizeRationale = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new ValidationError("`rationale` must be a non-empty string.");
  }

  return trimmed;
};

const parsePreferenceValue = (valueJson: string) => {
  try {
    return JSON.parse(valueJson) as UserPreference["value"];
  } catch (error) {
    throw new DatabaseError("Stored user preference payload is invalid JSON.", error);
  }
};

const getMarketPreferenceSelect = () => ({
  id: marketPreferences.id,
  userPreferenceId: marketPreferences.userPreferenceId,
  polymarketMarketId: marketPreferences.polymarketMarketId,
  rank: marketPreferences.rank,
  rationale: marketPreferences.rationale,
  createdAt: marketPreferences.createdAt,
  updatedAt: marketPreferences.updatedAt,
  clerkUserId: users.clerkUserId,
  preferenceTopic: userPreferences.topic,
  preferenceValueJson: userPreferences.valueJson,
  preferenceCreatedAt: userPreferences.createdAt,
  preferenceUpdatedAt: userPreferences.updatedAt,
  marketSlug: polymarketMarkets.slug,
  marketConditionId: polymarketMarkets.conditionId,
  marketQuestion: polymarketMarkets.question,
  marketOutcomesJson: polymarketMarkets.outcomesJson,
  marketTokenIdsJson: polymarketMarkets.tokenIdsJson,
  marketTickSize: polymarketMarkets.tickSize,
  marketNegRisk: polymarketMarkets.negRisk,
  marketOrderMinSize: polymarketMarkets.orderMinSize,
  marketEnableOrderBook: polymarketMarkets.enableOrderBook,
  marketAcceptingOrders: polymarketMarkets.acceptingOrders,
  marketActive: polymarketMarkets.active,
  marketClosed: polymarketMarkets.closed,
  marketSourceUpdatedAt: polymarketMarkets.sourceUpdatedAt,
  marketIndexedAt: polymarketMarkets.indexedAt,
});

const createMarketPreferenceQuery = (db: AppDatabase) =>
  db
    .select(getMarketPreferenceSelect())
    .from(marketPreferences)
    .innerJoin(
      userPreferences,
      eq(marketPreferences.userPreferenceId, userPreferences.id),
    )
    .innerJoin(users, eq(userPreferences.userId, users.id))
    .innerJoin(
      polymarketMarkets,
      eq(marketPreferences.polymarketMarketId, polymarketMarkets.id),
    );

const mapIndexedMarket = (
  row: JoinedMarketPreferenceRow,
): IndexedPolymarketMarket => {
  const outcomes = JSON.parse(row.marketOutcomesJson) as string[];
  const tokenIds = JSON.parse(row.marketTokenIdsJson) as string[];

  return {
    id: row.polymarketMarketId,
    slug: row.marketSlug,
    conditionId: row.marketConditionId,
    question: row.marketQuestion,
    outcomes: outcomes.map((name, index) => ({
      name,
      tokenId: tokenIds[index] ?? "",
    })),
    tickSize: row.marketTickSize,
    negRisk: row.marketNegRisk,
    orderMinSize: row.marketOrderMinSize,
    enableOrderBook: row.marketEnableOrderBook,
    acceptingOrders: row.marketAcceptingOrders,
    active: row.marketActive,
    closed: row.marketClosed,
    sourceUpdatedAt: row.marketSourceUpdatedAt,
    indexedAt: row.marketIndexedAt,
  };
};

const mapUserPreference = (
  row: JoinedMarketPreferenceRow,
): MarketPreference["userPreference"] => ({
  id: row.userPreferenceId,
  clerkUserId: row.clerkUserId,
  topic: row.preferenceTopic,
  value: parsePreferenceValue(row.preferenceValueJson),
  marketPreferenceEligible: true,
  createdAt: row.preferenceCreatedAt,
  updatedAt: row.preferenceUpdatedAt,
});

const mapMarketPreference = (row: JoinedMarketPreferenceRow): MarketPreference => ({
  id: row.id,
  userPreferenceId: row.userPreferenceId,
  polymarketMarketId: row.polymarketMarketId,
  rank: row.rank,
  rationale: row.rationale,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  userPreference: mapUserPreference(row),
  polymarketMarket: mapIndexedMarket(row),
});

const getMarketPreferenceById = (db: AppDatabase, id: number) =>
  createMarketPreferenceQuery(db)
    .where(eq(marketPreferences.id, id))
    .get();

const ensureUserPreferenceExists = (db: AppDatabase, id: number) => {
  const preference = db
    .select({ id: userPreferences.id })
    .from(userPreferences)
    .where(eq(userPreferences.id, id))
    .get();

  if (!preference) {
    throw new NotFoundError("User preference not found.");
  }
};

const ensurePolymarketMarketExists = (db: AppDatabase, id: number) => {
  const market = db
    .select({ id: polymarketMarkets.id })
    .from(polymarketMarkets)
    .where(eq(polymarketMarkets.id, id))
    .get();

  if (!market) {
    throw new NotFoundError("Indexed Polymarket market not found.");
  }
};

const isDuplicateMarketPreferenceError = (error: unknown) =>
  error instanceof Error &&
  error.message.includes(
    "UNIQUE constraint failed: market_preferences.user_preference_id, market_preferences.polymarket_market_id",
  );

export const createCreateMarketPreferenceService = ({
  db: injectedDb,
}: MarketPreferenceServiceDeps = {}) => {
  return async (input: CreateMarketPreferenceInput): Promise<MarketPreference> => {
    const db = injectedDb ?? getDb();
    const userPreferenceId = normalizePositiveInteger(
      input.userPreferenceId,
      "userPreferenceId",
    );
    const polymarketMarketId = normalizePositiveInteger(
      input.polymarketMarketId,
      "polymarketMarketId",
    );
    const rank = normalizePositiveInteger(input.rank, "rank");
    const rationale = normalizeRationale(input.rationale);

    ensureUserPreferenceExists(db, userPreferenceId);
    ensurePolymarketMarketExists(db, polymarketMarketId);

    try {
      const timestamp = new Date().toISOString();
      const inserted = db
        .insert(marketPreferences)
        .values({
          userPreferenceId,
          polymarketMarketId,
          rank,
          rationale,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning({ id: marketPreferences.id })
        .get();
      const stored = getMarketPreferenceById(db, inserted.id);

      if (!stored) {
        throw new DatabaseError("Failed to read the newly created market preference.");
      }

      return mapMarketPreference(stored);
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }

      if (isDuplicateMarketPreferenceError(error)) {
        throw new ConflictError(
          "A market preference for that user preference and market already exists.",
        );
      }

      throw new DatabaseError("Failed to persist the market preference.", error);
    }
  };
};

export const createUpdateMarketPreferenceService = ({
  db: injectedDb,
}: MarketPreferenceServiceDeps = {}) => {
  return async (input: UpdateMarketPreferenceInput): Promise<MarketPreference> => {
    const db = injectedDb ?? getDb();
    const id = normalizePositiveInteger(input.id, "id");
    const rank = normalizePositiveInteger(input.rank, "rank");
    const rationale = normalizeRationale(input.rationale);
    const existing = getMarketPreferenceById(db, id);

    if (!existing) {
      throw new NotFoundError("Market preference not found.");
    }

    try {
      db.update(marketPreferences)
        .set({
          rank,
          rationale,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(marketPreferences.id, id))
        .run();

      const stored = getMarketPreferenceById(db, id);

      if (!stored) {
        throw new DatabaseError("Failed to read the updated market preference.");
      }

      return mapMarketPreference(stored);
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }

      throw new DatabaseError("Failed to update the market preference.", error);
    }
  };
};

export const createGetMarketPreferenceService = ({
  db: injectedDb,
}: MarketPreferenceServiceDeps = {}) => {
  return async (input: GetMarketPreferenceInput): Promise<MarketPreference> => {
    const db = injectedDb ?? getDb();
    const id = normalizePositiveInteger(input.id, "id");
    const stored = getMarketPreferenceById(db, id);

    if (!stored) {
      throw new NotFoundError("Market preference not found.");
    }

    return mapMarketPreference(stored);
  };
};

export const createListMarketPreferencesService = ({
  db: injectedDb,
}: MarketPreferenceServiceDeps = {}) => {
  return async (
    input: ListMarketPreferencesInput = {},
  ): Promise<MarketPreference[]> => {
    const db = injectedDb ?? getDb();
    const conditions = [
      input.clerkUserId
        ? eq(users.clerkUserId, input.clerkUserId.trim())
        : undefined,
      input.userPreferenceId === undefined
        ? undefined
        : eq(
            marketPreferences.userPreferenceId,
            normalizePositiveInteger(input.userPreferenceId, "userPreferenceId"),
          ),
      input.polymarketMarketId === undefined
        ? undefined
        : eq(
            marketPreferences.polymarketMarketId,
            normalizePositiveInteger(input.polymarketMarketId, "polymarketMarketId"),
          ),
    ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const query = createMarketPreferenceQuery(db).orderBy(
      asc(marketPreferences.userPreferenceId),
      asc(marketPreferences.rank),
      asc(marketPreferences.id),
    );
    const rows = (whereClause ? query.where(whereClause) : query).all();

    return rows.map(mapMarketPreference);
  };
};

export const createDeleteMarketPreferenceService = ({
  db: injectedDb,
}: MarketPreferenceServiceDeps = {}) => {
  return async (input: DeleteMarketPreferenceInput): Promise<void> => {
    const db = injectedDb ?? getDb();
    const id = normalizePositiveInteger(input.id, "id");
    const existing = db
      .select({ id: marketPreferences.id })
      .from(marketPreferences)
      .where(eq(marketPreferences.id, id))
      .get();

    if (!existing) {
      throw new NotFoundError("Market preference not found.");
    }

    try {
      db.delete(marketPreferences).where(eq(marketPreferences.id, id)).run();
    } catch (error) {
      throw new DatabaseError("Failed to delete the market preference.", error);
    }
  };
};
