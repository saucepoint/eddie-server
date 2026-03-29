CREATE TABLE `polymarket_markets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`condition_id` text NOT NULL,
	`question` text NOT NULL,
	`outcomes_json` text NOT NULL,
	`token_ids_json` text NOT NULL,
	`tick_size` text NOT NULL,
	`neg_risk` integer NOT NULL,
	`order_min_size` text,
	`enable_order_book` integer NOT NULL,
	`accepting_orders` integer NOT NULL,
	`active` integer NOT NULL,
	`closed` integer NOT NULL,
	`source_updated_at` text,
	`indexed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `polymarket_markets_slug_unique` ON `polymarket_markets` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `polymarket_markets_condition_id_unique` ON `polymarket_markets` (`condition_id`);--> statement-breakpoint
CREATE TABLE `polymarket_trade_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`market_slug` text NOT NULL,
	`condition_id` text NOT NULL,
	`outcome` text NOT NULL,
	`token_id` text NOT NULL,
	`side` text NOT NULL,
	`amount` text NOT NULL,
	`limit_price` text NOT NULL,
	`order_type` text NOT NULL,
	`status` text NOT NULL,
	`live` integer NOT NULL,
	`response_order_id` text,
	`response_status` text,
	`transaction_hashes_json` text,
	`response_json` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`completed_at` text
);
