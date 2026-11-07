ALTER TABLE `works` ADD `favorite` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `works` SET `favorite` = 1 WHERE `id` IN (SELECT `work_id` FROM `work_favorites`);--> statement-breakpoint
DROP TABLE `work_favorites`;
