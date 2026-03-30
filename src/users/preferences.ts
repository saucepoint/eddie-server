import { and, eq, inArray } from "drizzle-orm";
import { getDb, type AppDatabase } from "../db/client";
import { userPreferences, users } from "../db/schema";
import { DatabaseError, NotFoundError } from "../errors";

export type PreferenceValue =
  | string
  | number
  | boolean
  | PreferenceValue[]
  | { [key: string]: PreferenceValue };

export type UserPreference = {
  clerkUserId: string;
  topic: string;
  value: PreferenceValue;
  createdAt: string;
  updatedAt: string;
};

export type UpsertUserPreferenceInput = {
  clerkUserId: string;
  topic: string;
  value: PreferenceValue;
};

export type UpsertUserPreferenceResult = {
  created: boolean;
  preference: UserPreference;
};

export type UpsertUserPreferencesInput = {
  clerkUserId: string;
  preferences: Record<string, PreferenceValue>;
};

export type UpsertUserPreferencesResult = {
  preferences: UserPreference[];
};

export type GetUserPreferenceInput = {
  clerkUserId: string;
  topic: string;
};

export type ListUserPreferencesInput = {
  clerkUserId: string;
  topics?: string[];
};

export type UserPreferenceServiceDeps = {
  db?: AppDatabase;
};

const normalizeTopic = (topic: string) => topic.trim().toLowerCase();
const coverageTierTopic = normalizeTopic("coverageTier");
const coverageTierValues = new Set(["low", "moderate", "high"]);

const parsePreferenceValue = (valueJson: string): PreferenceValue => {
  try {
    return JSON.parse(valueJson) as PreferenceValue;
  } catch (error) {
    throw new DatabaseError("Stored user preference payload is invalid JSON.", error);
  }
};

const mapPreference = (
  clerkUserId: string,
  row: {
    topic: string;
    valueJson: string;
    createdAt: string;
    updatedAt: string;
  },
): UserPreference => ({
  clerkUserId,
  topic: row.topic,
  value: parsePreferenceValue(row.valueJson),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const getPreferenceRecordColumns = () => ({
  id: userPreferences.id,
  topic: userPreferences.topic,
  valueJson: userPreferences.valueJson,
  createdAt: userPreferences.createdAt,
  updatedAt: userPreferences.updatedAt,
});

const isCoverageTierValue = (value: PreferenceValue): value is string =>
  typeof value === "string" && coverageTierValues.has(value);

const resolveUser = (db: AppDatabase, clerkUserId: string) => {
  const user = db
    .select({
      id: users.id,
      clerkUserId: users.clerkUserId,
      coverageTier: users.coverageTier,
    })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .get();

  if (!user) {
    throw new NotFoundError("User not found.");
  }

  return user;
};

const mapCoverageTierPreference = (
  clerkUserId: string,
  coverageTier: string,
  updatedAt = "",
): UserPreference => ({
  clerkUserId,
  topic: coverageTierTopic,
  value: coverageTier,
  createdAt: updatedAt,
  updatedAt,
});

const upsertCoverageTierPreference = (
  db: AppDatabase,
  user: ReturnType<typeof resolveUser>,
  value: PreferenceValue,
) => {
  if (!isCoverageTierValue(value)) {
    throw new DatabaseError("Coverage tier must be `low`, `moderate`, or `high`.");
  }

  const timestamp = new Date().toISOString();
  const updatedUser = db
    .update(users)
    .set({
      coverageTier: value,
    })
    .where(eq(users.id, user.id))
    .returning({
      coverageTier: users.coverageTier,
    })
    .get();

  if (!updatedUser) {
    throw new DatabaseError("Failed to persist the user coverage tier.");
  }

  return {
    created: updatedUser.coverageTier !== user.coverageTier,
    preference: mapCoverageTierPreference(
      user.clerkUserId,
      updatedUser.coverageTier,
      timestamp,
    ),
  };
};

const upsertPreferenceRecord = (
  db: AppDatabase,
  user: ReturnType<typeof resolveUser>,
  input: UpsertUserPreferenceInput,
): UpsertUserPreferenceResult => {
  const topic = normalizeTopic(input.topic);

  if (topic === coverageTierTopic) {
    return upsertCoverageTierPreference(db, user, input.value);
  }

  const valueJson = JSON.stringify(input.value);
  const timestamp = new Date().toISOString();

  const existingPreference = db
    .select({
      id: userPreferences.id,
    })
    .from(userPreferences)
    .where(
      and(
        eq(userPreferences.userId, user.id),
        eq(userPreferences.topic, topic),
      ),
    )
    .get();

  if (existingPreference) {
    const updatedPreference = db
      .update(userPreferences)
      .set({
        valueJson,
        updatedAt: timestamp,
      })
      .where(eq(userPreferences.id, existingPreference.id))
      .returning(getPreferenceRecordColumns())
      .get();

    if (!updatedPreference) {
      throw new DatabaseError("Failed to read the updated user preference.");
    }

    return {
      created: false,
      preference: mapPreference(user.clerkUserId, updatedPreference),
    };
  }

  const insertedPreference = db
    .insert(userPreferences)
    .values({
      userId: user.id,
      topic,
      valueJson,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning(getPreferenceRecordColumns())
    .get();

  if (!insertedPreference) {
    throw new DatabaseError("Failed to read the newly created user preference.");
  }

  return {
    created: true,
    preference: mapPreference(user.clerkUserId, insertedPreference),
  };
};

export const createUpsertUserPreferenceService = ({
  db: injectedDb,
}: UserPreferenceServiceDeps = {}) => {
  return async (
    input: UpsertUserPreferenceInput,
  ): Promise<UpsertUserPreferenceResult> => {
    const db = injectedDb ?? getDb();
    const user = resolveUser(db, input.clerkUserId);

    try {
      return upsertPreferenceRecord(db, user, input);
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }

      throw new DatabaseError("Failed to persist the user preference.", error);
    }
  };
};

export const createUpsertUserPreferencesService = ({
  db: injectedDb,
}: UserPreferenceServiceDeps = {}) => {
  return async (
    input: UpsertUserPreferencesInput,
  ): Promise<UpsertUserPreferencesResult> => {
    const db = injectedDb ?? getDb();
    const user = resolveUser(db, input.clerkUserId);
    const coverageTierEntry = Object.entries(input.preferences).find(
      ([topic]) => normalizeTopic(topic) === coverageTierTopic,
    );
    const remainingPreferences = Object.fromEntries(
      Object.entries(input.preferences).filter(
        ([topic]) => normalizeTopic(topic) !== coverageTierTopic,
      ),
    );

    try {
      return db.transaction((tx) => ({
        preferences: [
          ...(coverageTierEntry
            ? [
                upsertCoverageTierPreference(
                  tx as unknown as AppDatabase,
                  user,
                  coverageTierEntry[1],
                ).preference,
              ]
            : []),
          ...Object.entries(remainingPreferences).map((entry) =>
            upsertPreferenceRecord(tx as unknown as AppDatabase, user, {
              clerkUserId: input.clerkUserId,
              topic: entry[0],
              value: entry[1],
            }).preference,
          ),
        ],
      }));
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }

      throw new DatabaseError("Failed to persist the user preferences.", error);
    }
  };
};

export const createGetUserPreferenceService = ({
  db: injectedDb,
}: UserPreferenceServiceDeps = {}) => {
  return async (input: GetUserPreferenceInput): Promise<UserPreference> => {
    const db = injectedDb ?? getDb();
    const user = resolveUser(db, input.clerkUserId);
    const topic = normalizeTopic(input.topic);

    if (topic === coverageTierTopic) {
      return mapCoverageTierPreference(user.clerkUserId, user.coverageTier);
    }

    const preference = db
      .select({
        topic: userPreferences.topic,
        valueJson: userPreferences.valueJson,
        createdAt: userPreferences.createdAt,
        updatedAt: userPreferences.updatedAt,
      })
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, user.id),
          eq(userPreferences.topic, topic),
        ),
      )
      .get();

    if (!preference) {
      throw new NotFoundError("User preference not found.");
    }

    return mapPreference(user.clerkUserId, preference);
  };
};

export const createListUserPreferencesService = ({
  db: injectedDb,
}: UserPreferenceServiceDeps = {}) => {
  return async (input: ListUserPreferencesInput): Promise<UserPreference[]> => {
    const db = injectedDb ?? getDb();
    const user = resolveUser(db, input.clerkUserId);
    const topics = input.topics?.map(normalizeTopic) ?? null;
    const includesCoverageTier = !topics || topics.includes(coverageTierTopic);
    const preferenceTopics = topics?.filter((topic) => topic !== coverageTierTopic) ?? null;

    if (topics && preferenceTopics?.length === 0 && !includesCoverageTier) {
      return [];
    }

    const whereClause = preferenceTopics
      ? and(
          eq(userPreferences.userId, user.id),
          inArray(userPreferences.topic, preferenceTopics),
        )
      : eq(userPreferences.userId, user.id);

    const preferences = preferenceTopics && preferenceTopics.length === 0
      ? []
      : db
          .select(getPreferenceRecordColumns())
          .from(userPreferences)
          .where(whereClause)
          .all();

    return [
      ...(includesCoverageTier
        ? [mapCoverageTierPreference(user.clerkUserId, user.coverageTier)]
        : []),
      ...preferences.map((preference) =>
        mapPreference(user.clerkUserId, preference),
      ),
    ];
  };
};
