import { and, eq } from "drizzle-orm";
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

export type GetUserPreferenceInput = {
  clerkUserId: string;
  topic: string;
};

export type UserPreferenceServiceDeps = {
  db?: AppDatabase;
};

const normalizeTopic = (topic: string) => topic.trim().toLowerCase();

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

const resolveUser = (db: AppDatabase, clerkUserId: string) => {
  const user = db
    .select({
      id: users.id,
      clerkUserId: users.clerkUserId,
    })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .get();

  if (!user) {
    throw new NotFoundError("User not found.");
  }

  return user;
};

export const createUpsertUserPreferenceService = ({
  db: injectedDb,
}: UserPreferenceServiceDeps = {}) => {
  return async (
    input: UpsertUserPreferenceInput,
  ): Promise<UpsertUserPreferenceResult> => {
    const db = injectedDb ?? getDb();
    const user = resolveUser(db, input.clerkUserId);
    const topic = normalizeTopic(input.topic);
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

    try {
      if (existingPreference) {
        const updatedPreference = db
          .update(userPreferences)
          .set({
            valueJson,
            updatedAt: timestamp,
          })
          .where(eq(userPreferences.id, existingPreference.id))
          .returning({
            topic: userPreferences.topic,
            valueJson: userPreferences.valueJson,
            createdAt: userPreferences.createdAt,
            updatedAt: userPreferences.updatedAt,
          })
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
        .returning({
          topic: userPreferences.topic,
          valueJson: userPreferences.valueJson,
          createdAt: userPreferences.createdAt,
          updatedAt: userPreferences.updatedAt,
        })
        .get();

      if (!insertedPreference) {
        throw new DatabaseError("Failed to read the newly created user preference.");
      }

      return {
        created: true,
        preference: mapPreference(user.clerkUserId, insertedPreference),
      };
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }

      throw new DatabaseError("Failed to persist the user preference.", error);
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
