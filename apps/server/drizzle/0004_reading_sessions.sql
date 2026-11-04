CREATE TABLE `reading_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`copy_id` text NOT NULL,
	`status` text NOT NULL,
	`started_on` text,
	`finished_on` text,
	`rating` real,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`copy_id`) REFERENCES `copies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reading_sessions_copy_idx` ON `reading_sessions` (`copy_id`);