/**
 * Sync contracts: pull (F2) and push (F3). See §6 of the design document.
 *
 * - First connection: GET /sync/snapshot → every live entity plus the cursor to continue from.
 * - Afterwards: GET /sync/pull?since=<cursor>&epoch=<epoch> → the CURRENT state of every entity
 *   changed after the cursor (one record per entity, however many times it changed) and the ids
 *   deleted since then. Clients upsert the records and drop the tombstones.
 * - If the server's epoch differs (a backup was restored) the pull answers 409 `epoch-mismatch`:
 *   the client must discard its copy and take a new snapshot.
 * - Within a page records are not ordered by dependency (a copy may arrive before its edition):
 *   apply a whole page in one transaction and do not enforce foreign keys locally.
 */
import { z } from 'zod';
import {
  BookCreate,
  CopyCreate,
  CopyPatch,
  EditionPatch,
  Id,
  LocationCreate,
  LocationPatch,
  ReadingCreate,
  ReadingPatch,
  WishCreate,
  WishPatch,
  QuoteCreate,
  QuotePatch,
  WorkPatch,
  type Condition,
  type ConflictProblem,
  type LocationKind,
  type ReadingStatus,
  type RetireReason,
} from './catalog.js';

export const SYNC_ENTITIES = ['work', 'edition', 'copy', 'location', 'reading', 'wish', 'quote'] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

type SyncMeta = { id: string; version: number; createdAt: string; updatedAt: string };

export type SyncWork = SyncMeta & {
  title: string;
  subtitle: string | null;
  authors: string[];
  subjects: string[];
  description: string | null;
  originalTitle: string | null;
  originalLanguage: string | null;
  series: string | null;
  seriesIndex: number | null;
  favorite: boolean;
};

export type SyncEdition = SyncMeta & {
  workId: string;
  title: string | null;
  subtitle: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pages: number | null;
  format: string | null;
  isbn13: string | null;
  coverAssetId: string | null;
  metadataStatus: 'complete' | 'provisional';
  metadataSource: string | null;
};

export type SyncCopy = SyncMeta & {
  editionId: string;
  code: string;
  locationId: string | null;
  condition: Condition;
  acquiredOn: string | null;
  priceCents: number | null;
  priceCurrency: string;
  notes: string;
  status: 'active' | 'retired';
  retiredReason: RetireReason | null;
  retiredOn: string | null;
};

export type SyncLocation = SyncMeta & {
  parentId: string | null;
  name: string;
  kind: LocationKind;
  sortOrder: number;
};

export type SyncReading = SyncMeta & {
  copyId: string;
  status: ReadingStatus;
  startedOn: string | null;
  finishedOn: string | null;
  rating: number | null;
  notes: string;
};

export type SyncWish = SyncMeta & {
  title: string;
  authors: string[];
  isbn13: string | null;
  workId: string | null;
  priority: 'low' | 'normal' | 'high';
  notes: string;
  status: 'open' | 'acquired' | 'discarded';
  acquiredCopyId: string | null;
  coverAssetId: string | null;
};

export type SyncQuote = SyncMeta & {
  workId: string;
  copyId: string | null;
  text: string;
  page: number | null;
  note: string;
};

export type SyncTombstone = { entity: SyncEntity; id: string; version: number; deletedAt: string };

/** Entities grouped by type: simple to consume from Kotlin (no polymorphic records). */
export type SyncRecords = {
  works: SyncWork[];
  editions: SyncEdition[];
  copies: SyncCopy[];
  locations: SyncLocation[];
  readings: SyncReading[];
  wishes: SyncWish[];
  quotes: SyncQuote[];
};

export type SyncSnapshot = SyncRecords & {
  epoch: string;
  /** Pass it as `since` in the next pull. */
  cursor: number;
  serverTime: string;
};

export type SyncPullPage = SyncRecords & {
  epoch: string;
  deleted: SyncTombstone[];
  /** Pass it as `since` in the next pull (equals `since` when nothing changed). */
  cursor: number;
  /** More changes are waiting: pull again right away with the new cursor. */
  hasMore: boolean;
  serverTime: string;
};

export const SYNC_PULL_MAX = 1000;

export const SyncPullQuery = z.object({
  since: z.coerce.number().int().min(0),
  epoch: z.string().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(SYNC_PULL_MAX).default(500),
});
export type SyncPullQuery = z.input<typeof SyncPullQuery>;

// ============================================================================
// Push (F3): changes made offline on a device, sent as a batch of operations.
//
// - Each operation has a client-generated `opId`. The server stores the result of every applied op, so
//   resending a batch (lost response, retry) returns `duplicate` with the original result and changes
//   nothing.
// - Operations of a batch are applied in order, each in its own transaction; one that fails does not
//   stop the rest (an op that depends on a failed one fails too, with its own reason).
// - `conflict`: another device changed some of the same fields after `baseVersion`. NOTHING of that op
//   is applied; `conflicts` lists the server value and yours per field. Resolving it is a new op.
// - `rejected`: the op is invalid (validation, missing entity…); `message` is translated.
// ============================================================================
export const SYNC_PUSH_MAX = 100;

const update = <K extends string, T extends z.ZodType>(type: K, patch: T) =>
  z.object({ opId: Id, type: z.literal(type), id: Id, patch });

export const SyncOp = z.discriminatedUnion('type', [
  z.object({ opId: Id, type: z.literal('book.create'), book: BookCreate }),
  z.object({ opId: Id, type: z.literal('copy.create'), copy: CopyCreate }),
  z.object({ opId: Id, type: z.literal('location.create'), location: LocationCreate }),
  z.object({ opId: Id, type: z.literal('reading.create'), reading: ReadingCreate }),
  z.object({ opId: Id, type: z.literal('wish.create'), wish: WishCreate }),
  z.object({ opId: Id, type: z.literal('quote.create'), quote: QuoteCreate }),
  z.object({ opId: Id, type: z.literal('quote.delete'), id: Id }),
  z.object({ opId: Id, type: z.literal('wish.delete'), id: Id }),
  update('work.update', WorkPatch),
  update('edition.update', EditionPatch),
  update('copy.update', CopyPatch),
  update('location.update', LocationPatch),
  update('reading.update', ReadingPatch),
  update('wish.update', WishPatch),
  update('quote.update', QuotePatch),
]);
export type SyncOp = z.input<typeof SyncOp>;

export const SyncPushRequest = z.object({
  epoch: z.string().min(1).max(64),
  /** Each op is validated on its own so one invalid op is `rejected` without failing the batch. */
  ops: z
    .array(z.object({ opId: Id }).loose())
    .min(1)
    .max(SYNC_PUSH_MAX),
});
export type SyncPushRequest = { epoch: string; ops: SyncOp[] };

export type SyncOpResult = {
  opId: string;
  status: 'applied' | 'duplicate' | 'conflict' | 'rejected';
  /** Error code (`conflict`, `validation`, `duplicate-isbn`, `not-found`…) when not applied. */
  code?: string;
  message?: string;
  conflicts?: ConflictProblem['conflicts'];
  currentVersion?: number;
};
export type SyncPushResponse = { epoch: string; results: SyncOpResult[]; serverTime: string };
