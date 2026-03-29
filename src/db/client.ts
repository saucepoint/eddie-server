import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export const createDatabaseClient = (filename = "sqlite.db") => {
  const sqlite = new Database(filename, { create: true });
  const db = drizzle({ client: sqlite, schema });

  migrate(db, { migrationsFolder });

  return { sqlite, db };
};

let databaseClient: ReturnType<typeof createDatabaseClient> | null = null;

export const getDatabaseClient = () => {
  databaseClient ??= createDatabaseClient(Bun.env.DATABASE_URL ?? "sqlite.db");
  return databaseClient;
};

export const getSqlite = () => getDatabaseClient().sqlite;
export const getDb = () => getDatabaseClient().db;

export type AppDatabase = ReturnType<typeof getDb>;
