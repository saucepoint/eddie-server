import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  username: text("username").notNull(),
  phoneNumber: text("phone_number").notNull().unique(),
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  walletAddress: text("wallet_address").notNull().unique(),
  safeAddress: text("safe_address").notNull().unique(),
  safeDeploymentTransactionId: text("safe_deployment_transaction_id").notNull(),
  safeDeploymentTransactionHash: text("safe_deployment_transaction_hash").notNull(),
  approvalTransactionId: text("approval_transaction_id").notNull(),
  approvalTransactionHash: text("approval_transaction_hash").notNull(),
});

export const polymarketMarkets = sqliteTable("polymarket_markets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  conditionId: text("condition_id").notNull().unique(),
  question: text("question").notNull(),
  outcomesJson: text("outcomes_json").notNull(),
  tokenIdsJson: text("token_ids_json").notNull(),
  tickSize: text("tick_size").notNull(),
  negRisk: integer("neg_risk", { mode: "boolean" }).notNull(),
  orderMinSize: text("order_min_size"),
  enableOrderBook: integer("enable_order_book", { mode: "boolean" }).notNull(),
  acceptingOrders: integer("accepting_orders", { mode: "boolean" }).notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
  closed: integer("closed", { mode: "boolean" }).notNull(),
  sourceUpdatedAt: text("source_updated_at"),
  indexedAt: text("indexed_at").notNull(),
});

export const polymarketTradeAttempts = sqliteTable("polymarket_trade_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  marketSlug: text("market_slug").notNull(),
  conditionId: text("condition_id").notNull(),
  outcome: text("outcome").notNull(),
  tokenId: text("token_id").notNull(),
  side: text("side").notNull(),
  amount: text("amount").notNull(),
  limitPrice: text("limit_price").notNull(),
  orderType: text("order_type").notNull(),
  status: text("status").notNull(),
  live: integer("live", { mode: "boolean" }).notNull(),
  responseOrderId: text("response_order_id"),
  responseStatus: text("response_status"),
  transactionHashesJson: text("transaction_hashes_json"),
  responseJson: text("response_json"),
  errorMessage: text("error_message"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const userPreferences = sqliteTable(
  "user_preferences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    topic: text("topic").notNull(),
    valueJson: text("value_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  table => ({
    userTopicUnique: uniqueIndex("user_preferences_user_id_topic_unique").on(
      table.userId,
      table.topic,
    ),
  }),
);
