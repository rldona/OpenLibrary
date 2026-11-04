CREATE TABLE `applied_ops` (
	`op_id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`result` text NOT NULL,
	`at` text NOT NULL
);
