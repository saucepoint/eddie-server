PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`clerk_user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`username` text NOT NULL,
	`phone_number` text NOT NULL,
	`encrypted_private_key` text NOT NULL,
	`wallet_address` text NOT NULL,
	`safe_address` text NOT NULL,
	`safe_deployment_transaction_id` text NOT NULL,
	`safe_deployment_transaction_hash` text NOT NULL,
	`approval_transaction_id` text NOT NULL,
	`approval_transaction_hash` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_users` (
	`id`,
	`clerk_user_id`,
	`display_name`,
	`username`,
	`phone_number`,
	`encrypted_private_key`,
	`wallet_address`,
	`safe_address`,
	`safe_deployment_transaction_id`,
	`safe_deployment_transaction_hash`,
	`approval_transaction_id`,
	`approval_transaction_hash`
)
SELECT
	`id`,
	'legacy-user-' || `id`,
	`display_name`,
	`display_name`,
	`phone_number`,
	`encrypted_private_key`,
	`wallet_address`,
	`safe_address`,
	`safe_deployment_transaction_id`,
	`safe_deployment_transaction_hash`,
	`approval_transaction_id`,
	`approval_transaction_hash`
FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_clerk_user_id_unique` ON `users` (`clerk_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_number_unique` ON `users` (`phone_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_wallet_address_unique` ON `users` (`wallet_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_safe_address_unique` ON `users` (`safe_address`);
