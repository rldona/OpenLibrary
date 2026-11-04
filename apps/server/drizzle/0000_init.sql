CREATE TABLE `auth_failures` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer NOT NULL,
	`window_start` text NOT NULL,
	`locked_until` text
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `owner` (
	`id` integer PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`password_changed_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "owner_singleton" CHECK("owner"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`user_agent` text,
	`created_at` text NOT NULL,
	`last_seen_at` text,
	`expires_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_kind_idx` ON `sessions` (`kind`);