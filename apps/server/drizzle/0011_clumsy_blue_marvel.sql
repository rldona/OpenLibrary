CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`transports` text,
	`name` text NOT NULL,
	`backed_up` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`used_at` text
);
