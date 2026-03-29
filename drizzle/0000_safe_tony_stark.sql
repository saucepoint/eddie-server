CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text NOT NULL,
	`phone_number` text NOT NULL,
	`encrypted_private_key` text NOT NULL,
	`wallet_address` text NOT NULL,
	`safe_address` text NOT NULL,
	`safe_deployment_transaction_id` text NOT NULL,
	`safe_deployment_transaction_hash` text NOT NULL,
	`approval_transaction_id` text NOT NULL,
	`approval_transaction_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_number_unique` ON `users` (`phone_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_wallet_address_unique` ON `users` (`wallet_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_safe_address_unique` ON `users` (`safe_address`);