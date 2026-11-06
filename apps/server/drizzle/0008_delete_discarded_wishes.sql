-- Discarded wishes are deleted now: tombstone the existing ones exactly as softDelete does (version + 1,
-- a 'delete' row in change_log with no fields and no session, same timestamp), so devices drop them on
-- their next pull. Running it again changes nothing: only live discarded wishes match.
INSERT INTO `change_log` (`entity`, `entity_id`, `op`, `version`, `fields`, `session_id`, `at`)
SELECT 'wish', `id`, 'delete', `version` + 1, '{}', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `wishlist_items` WHERE `status` = 'discarded' AND `deleted_at` IS NULL;
--> statement-breakpoint
UPDATE `wishlist_items`
SET
  `deleted_at` = (
    SELECT `at` FROM `change_log`
    WHERE `entity` = 'wish' AND `entity_id` = `wishlist_items`.`id` AND `op` = 'delete'
    ORDER BY `seq` DESC LIMIT 1
  ),
  `updated_at` = (
    SELECT `at` FROM `change_log`
    WHERE `entity` = 'wish' AND `entity_id` = `wishlist_items`.`id` AND `op` = 'delete'
    ORDER BY `seq` DESC LIMIT 1
  ),
  `version` = `version` + 1
WHERE `status` = 'discarded' AND `deleted_at` IS NULL;
