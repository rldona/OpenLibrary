CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`work_id` text NOT NULL,
	`copy_id` text,
	`text` text NOT NULL,
	`page` integer,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `quotes_work_idx` ON `quotes` (`work_id`);