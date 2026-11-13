/**
 * Constants and plain helpers with no runtime dependency: the web app imports them (through
 * `@openlibrary/contracts/client`) without bundling zod. The schemas use the same arrays.
 */

export const API_PREFIX = '/api/v1';
export const PASSWORD_MIN_LENGTH = 12;

// ---------- Catalog enumerations (labels live in i18n.ts) ----------
export const LOCATION_KINDS = ['home', 'room', 'bookcase', 'shelf', 'box', 'other'] as const;
export const CONDITIONS = ['new', 'fine', 'good', 'used', 'fair', 'poor'] as const;
export const RETIRE_REASONS = ['gifted', 'sold', 'lost', 'damaged', 'other'] as const;
/** Reading of one copy (design §4, BR11–BR13). "pending" is also what a work without sessions is. */
export const READING_STATUSES = ['pending', 'reading', 'read', 'abandoned'] as const;
export const WISH_PRIORITIES = ['low', 'normal', 'high'] as const;
export const WISH_STATUSES = ['open', 'acquired', 'discarded'] as const;

/** The derived reading status of a work (BR13). */
export const WORK_READING_STATUSES = ['pending', 'reading', 'read'] as const;
export type WorkReadingStatus = (typeof WORK_READING_STATUSES)[number];

/** BR13, shared by the server and the web (Android ports it): reading if any session is, read if any was. */
export function workReadingStatus(
  sessions: { status: (typeof READING_STATUSES)[number] }[],
): WorkReadingStatus {
  if (sessions.some((s) => s.status === 'reading')) return 'reading';
  if (sessions.some((s) => s.status === 'read')) return 'read';
  return 'pending';
}

// ---------- Library listing ----------
export const LIBRARY_SORTS = ['title', 'author', 'acquired', 'location', 'added'] as const;

// ---------- Portability and backups ----------
/** Uploads to /import (a zip with covers can be large). */
export const IMPORT_MAX_BYTES = 512 * 1024 * 1024;
export const IMPORT_ENTITIES = [
  'works',
  'editions',
  'copies',
  'locations',
  'readings',
  'quotes',
  'wishes',
  'assets',
] as const;
/** A backup older than this is reported as stale (design §9). */
export const BACKUP_STALE_DAYS = 3;
/** Minutes between automatic backups to Google Drive; 0 = manual only. */
export const DRIVE_BACKUP_INTERVALS = [0, 1, 5, 10, 15] as const;
export type DriveBackupInterval = (typeof DRIVE_BACKUP_INTERVALS)[number];
