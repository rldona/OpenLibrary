/**
 * Portability (F5): full export, CSV export and import of our own formats (design §7, A9).
 *
 * Full export: a zip with `library.json` (below) and the covers as `assets/<id>.jpg`. Every relation is by
 * id, so importing it into an empty installation gives back the same library. Importing `library.json`
 * on its own works too (without covers, unless the target already has them).
 *
 * CSV export: one row per copy, for spreadsheets. It loses reading history beyond the latest session,
 * quotes and wishes; importing it creates works, editions, copies and locations.
 *
 * Import always runs in two steps: a dry run that returns the report, then the real import of the same
 * file. Both apply the same rules in one transaction (the dry run rolls back), so the report is exact.
 */
import { z } from 'zod';
import {
  AssetId,
  CopyFields,
  EditionFields,
  Id,
  LocationKind,
  QuoteFields,
  ReadingFields,
  RetireReason,
  WishFields,
  WorkFields,
} from './catalog.js';
import { IMPORT_ENTITIES } from './constants.js';

export const EXPORT_FORMAT = 'openlibrary';
export const EXPORT_FORMAT_VERSION = 1;

const Timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'validation.invalidTimestamp');
const meta = { id: Id, createdAt: Timestamp, updatedAt: Timestamp };

/** One record of each array in library.json. Missing optional fields take their defaults. */
export const ExportWork = WorkFields.extend(meta);
export const ExportEdition = EditionFields.extend({ ...meta, workId: Id });
export const ExportCopy = CopyFields.extend({
  ...meta,
  editionId: Id,
  code: z.string().trim().min(1).max(40),
  status: z.enum(['active', 'retired']).default('active'),
  retiredReason: RetireReason.nullish().default(null),
  retiredOn: z.string().nullish().default(null),
});
export const ExportLocation = z.object({
  ...meta,
  parentId: Id.nullish().default(null),
  name: z.string().trim().min(1, 'validation.nameRequired').max(80),
  kind: LocationKind.default('other'),
  sortOrder: z.number().int().default(0),
});
export const ExportReading = ReadingFields.extend({ ...meta, copyId: Id });
export const ExportQuote = QuoteFields.extend({ ...meta, workId: Id });
export const ExportWish = WishFields.extend(meta);
export const ExportAsset = z.object({
  id: AssetId,
  mime: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  bytes: z.number().int(),
});

/** Top level of library.json. Records are validated one by one, so a bad row never voids the file. */
export const ExportFile = z.object({
  format: z.literal(EXPORT_FORMAT, 'import.notOurFormat'),
  format_version: z.number().int().min(1).max(EXPORT_FORMAT_VERSION, 'import.newerFormat'),
  exportedAt: z.string().optional(),
  app_version: z.string().optional(),
  works: z.array(z.unknown()).default([]),
  editions: z.array(z.unknown()).default([]),
  copies: z.array(z.unknown()).default([]),
  locations: z.array(z.unknown()).default([]),
  reading_sessions: z.array(z.unknown()).default([]),
  quotes: z.array(z.unknown()).default([]),
  wishlist: z.array(z.unknown()).default([]),
  assets: z.array(z.unknown()).default([]),
});

export type LibraryExport = {
  format: typeof EXPORT_FORMAT;
  format_version: number;
  exportedAt: string;
  app_version: string;
  works: z.output<typeof ExportWork>[];
  editions: z.output<typeof ExportEdition>[];
  copies: z.output<typeof ExportCopy>[];
  locations: z.output<typeof ExportLocation>[];
  reading_sessions: z.output<typeof ExportReading>[];
  quotes: z.output<typeof ExportQuote>[];
  wishlist: z.output<typeof ExportWish>[];
  assets: z.output<typeof ExportAsset>[];
};

/** Columns of the CSV export, in order. Import reads them by header name, so order does not matter. */
export const CSV_COLUMNS = [
  'code',
  'title',
  'subtitle',
  'authors',
  'isbn13',
  'publisher',
  'published_year',
  'language',
  'pages',
  'format',
  'subjects',
  'series',
  'series_index',
  'location',
  'condition',
  'acquired_on',
  'price',
  'currency',
  'status',
  'retired_reason',
  'notes',
  'reading_status',
  'rating',
  'work_id',
  'edition_id',
  'copy_id',
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];
/** Separator inside list cells (authors, subjects) and between location levels. */
export const CSV_LIST_SEPARATOR = '; ';
export const CSV_PATH_SEPARATOR = ' / ';

// ---------- Import report ----------
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export type ImportCounts = { created: number; duplicates: number; invalid: number };

export type ImportIssue = {
  /** `duplicate`: already in the library, skipped. `invalid`: cannot be imported. `warning`: imported with a change. */
  kind: 'duplicate' | 'invalid' | 'warning';
  entity: ImportEntity;
  /** 1-based position in its array of library.json, or the line number of the CSV file. */
  row: number;
  id: string | null;
  /** A title, name or code that helps find the record. */
  label: string | null;
  /** Translated explanation. */
  message: string;
};

export const IMPORT_ISSUES_MAX = 500;

export type ImportReport = {
  dryRun: boolean;
  source: 'zip' | 'json' | 'csv';
  counts: Record<ImportEntity, ImportCounts>;
  /** At most IMPORT_ISSUES_MAX; `issuesTotal` says how many there were. */
  issues: ImportIssue[];
  issuesTotal: number;
};

export const ImportQuery = z.object({
  dryRun: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
});

// ---------- Backups ----------
export type BackupStatus = {
  /** End of the last successful backup (written by deploy/scripts/backup.sh), null if never. */
  lastSuccessAt: string | null;
  stale: boolean;
};
