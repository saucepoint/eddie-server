CREATE TABLE `market_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_preference_id` integer NOT NULL,
	`polymarket_market_id` integer NOT NULL,
	`rank` integer NOT NULL,
	`rationale` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_preferences_user_preference_id_polymarket_market_id_unique` ON `market_preferences` (`user_preference_id`,`polymarket_market_id`);--> statement-breakpoint
CREATE INDEX `market_preferences_user_preference_id_idx` ON `market_preferences` (`user_preference_id`);--> statement-breakpoint
CREATE INDEX `market_preferences_polymarket_market_id_idx` ON `market_preferences` (`polymarket_market_id`);