CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes` integer NOT NULL,
	`origin` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `change_log` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`op` text NOT NULL,
	`version` integer NOT NULL,
	`fields` text NOT NULL,
	`session_id` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_log_entity_idx` ON `change_log` (`entity`,`entity_id`,`version`);--> statement-breakpoint
CREATE TABLE `copies` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`edition_id` text NOT NULL,
	`code` text NOT NULL,
	`location_id` text,
	`condition` text DEFAULT 'good' NOT NULL,
	`acquired_on` text,
	`price_cents` integer,
	`price_currency` text DEFAULT 'EUR' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`retired_reason` text,
	`retired_on` text,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `copies_code_unique` ON `copies` (`code`);--> statement-breakpoint
CREATE INDEX `copies_edition_idx` ON `copies` (`edition_id`);--> statement-breakpoint
CREATE INDEX `copies_location_idx` ON `copies` (`location_id`);--> statement-breakpoint
CREATE TABLE `editions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`work_id` text NOT NULL,
	`title` text,
	`subtitle` text,
	`publisher` text,
	`published_year` integer,
	`language` text,
	`pages` integer,
	`format` text,
	`isbn13` text,
	`cover_asset_id` text,
	`metadata_status` text DEFAULT 'complete' NOT NULL,
	`metadata_source` text,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `editions_work_idx` ON `editions` (`work_id`);--> statement-breakpoint
CREATE INDEX `editions_isbn13_idx` ON `editions` (`isbn13`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`parent_id` text,
	`name` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `locations_parent_idx` ON `locations` (`parent_id`);--> statement-breakpoint
CREATE TABLE `lookup_cache` (
	`isbn13` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `works` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`title` text NOT NULL,
	`subtitle` text,
	`authors` text DEFAULT '[]' NOT NULL,
	`subjects` text DEFAULT '[]' NOT NULL,
	`description` text,
	`original_title` text,
	`original_language` text,
	`series` text,
	`series_index` real,
	`sort_title` text DEFAULT '' NOT NULL,
	`sort_author` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `works_sort_title_idx` ON `works` (`sort_title`);--> statement-breakpoint
CREATE INDEX `works_sort_author_idx` ON `works` (`sort_author`);