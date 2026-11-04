CREATE TABLE `wishlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`title` text NOT NULL,
	`authors` text DEFAULT '[]' NOT NULL,
	`isbn13` text,
	`work_id` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`acquired_copy_id` text
);
--> statement-breakpoint
CREATE INDEX `wishlist_isbn_idx` ON `wishlist_items` (`isbn13`);