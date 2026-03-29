import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
