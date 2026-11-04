/**
 * Sync: full snapshot and incremental pull over the change log (F2), and push of offline operations (F3).
 *
 * The pull is state based: for every entity whose latest change is after the cursor it returns the
 * entity as it is NOW (not each intermediate change), ordered by that latest `seq`. Paging by the
 * latest seq is safe while writes keep happening: an entity changed again during paging simply
 * moves past the cursor and comes back in a later page.
 */
import { eq, inArray, isNull, sql } from 'drizzle-orm';
import { SyncOp, type Lang, type SyncOpResult, type SyncPushResponse } from '@openlibrary/contracts';
import type {
  SyncCopy,
  SyncEdition,
  SyncEntity,
  SyncLocation,
  SyncPullPage,
  SyncReading,
  SyncWish,
  SyncRecords,
  SyncSnapshot,
  SyncTombstone,
  SyncWork,
} from '@openlibrary/contracts';
import type { z } from 'zod';
import type * as C from '@openlibrary/contracts';
import { getMeta, type Db } from '../db/client.js';
import {
  appliedOps,
  changeLog,
  copies,
  editions,
  locations,
  readingSessions,
  wishlistItems,
  works,
} from '../db/schema.js';
import { HttpError, parse } from '../errors.js';
import { tr } from '../i18n.js';
import type { Clock } from '../auth/service.js';
import type { CatalogService } from '../catalog/service.js';
import { ConflictError, TABLES, type Tx } from '../catalog/changes.js';

type WorkRow = typeof works.$inferSelect;
type EditionRow = typeof editions.$inferSelect;
type CopyRow = typeof copies.$inferSelect;
type LocationRow = typeof locations.$inferSelect;
type ReadingRow = typeof readingSessions.$inferSelect;
type WishRow = typeof wishlistItems.$inferSelect;

const toWork = ({ sortTitle: _a, sortAuthor: _b, deletedAt: _c, ...w }: WorkRow): SyncWork => w;
const toEdition = ({ deletedAt: _d, ...e }: EditionRow): SyncEdition => e;
const toCopy = ({ deletedAt: _d, ...c }: CopyRow): SyncCopy => c as SyncCopy;
const toLocation = ({ deletedAt: _d, ...l }: LocationRow): SyncLocation => l;
const toReading = ({ deletedAt: _d, ...r }: ReadingRow): SyncReading => r;
const toWish = ({ deletedAt: _d, ...w }: WishRow): SyncWish => w;

const KEYS = {
  work: 'works',
  edition: 'editions',
  copy: 'copies',
  location: 'locations',
  reading: 'readings',
  wish: 'wishes',
} as const;

const resyncNeeded = (code: string, key: string) => new HttpError(409, code, key);

export class SyncService {
  constructor(
    private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly now: Clock = () => new Date(),
  ) {}

  private epoch = () => getMeta(this.db, 'epoch') ?? '';

  private lastSeq(tx: Tx): number {
    return (
      tx
        .select({ max: sql<number | null>`max(${changeLog.seq})` })
        .from(changeLog)
        .get()?.max ?? 0
    );
  }

  /** Every live entity, read in one transaction so the cursor matches the data exactly. */
  snapshot(): SyncSnapshot {
    return this.db.transaction((tx) => ({
      epoch: this.epoch(),
      cursor: this.lastSeq(tx),
      serverTime: this.now().toISOString(),
      works: tx.select().from(works).where(isNull(works.deletedAt)).orderBy(works.id).all().map(toWork),
      editions: tx
        .select()
        .from(editions)
        .where(isNull(editions.deletedAt))
        .orderBy(editions.id)
        .all()
        .map(toEdition),
      copies: tx.select().from(copies).where(isNull(copies.deletedAt)).orderBy(copies.id).all().map(toCopy),
      locations: tx
        .select()
        .from(locations)
        .where(isNull(locations.deletedAt))
        .orderBy(locations.id)
        .all()
        .map(toLocation),
      readings: tx
        .select()
        .from(readingSessions)
        .where(isNull(readingSessions.deletedAt))
        .orderBy(readingSessions.id)
        .all()
        .map(toReading),
      wishes: tx
        .select()
        .from(wishlistItems)
        .where(isNull(wishlistItems.deletedAt))
        .orderBy(wishlistItems.id)
        .all()
        .map(toWish),
    }));
  }

  pull(q: z.output<typeof C.SyncPullQuery>): SyncPullPage {
    if (q.epoch !== this.epoch()) throw resyncNeeded('epoch-mismatch', 'errors.epochMismatch');
    return this.db.transaction((tx) => {
      const last = this.lastSeq(tx);
      if (q.since > last) throw resyncNeeded('cursor-ahead', 'errors.cursorAhead');

      const latest = tx
        .select({
          entity: changeLog.entity,
          entityId: changeLog.entityId,
          seq: sql<number>`max(${changeLog.seq})`.as('last_seq'),
        })
        .from(changeLog)
        .where(sql`${changeLog.seq} > ${q.since}`)
        .groupBy(changeLog.entity, changeLog.entityId)
        .orderBy(sql`last_seq`)
        .limit(q.limit + 1)
        .all();
      const hasMore = latest.length > q.limit;
      const page = latest.slice(0, q.limit);

      const records: SyncRecords = {
        works: [],
        editions: [],
        copies: [],
        locations: [],
        readings: [],
        wishes: [],
      };
      const deleted: SyncTombstone[] = [];
      for (const entity of Object.keys(KEYS) as SyncEntity[]) {
        const ids = page.filter((c) => c.entity === entity).map((c) => c.entityId);
        if (!ids.length) continue;
        const table = TABLES[entity];
        const rows = new Map(
          (tx.select().from(table).where(inArray(table.id, ids)).all() as { id: string }[]).map((r) => [
            r.id,
            r,
          ]),
        );
        for (const id of ids) {
          const row = rows.get(id) as { version: number; deletedAt: string | null } | undefined;
          if (!row) continue;
          if (row.deletedAt) {
            deleted.push({ entity, id, version: row.version, deletedAt: row.deletedAt });
            continue;
          }
          // `row` comes from TABLES[entity], so each cast matches the branch it is in.
          if (entity === 'work') records.works.push(toWork(row as WorkRow));
          else if (entity === 'edition') records.editions.push(toEdition(row as EditionRow));
          else if (entity === 'copy') records.copies.push(toCopy(row as CopyRow));
          else if (entity === 'location') records.locations.push(toLocation(row as LocationRow));
          else if (entity === 'reading') records.readings.push(toReading(row as ReadingRow));
          else records.wishes.push(toWish(row as WishRow));
        }
      }

      // Without more pages the cursor jumps to the end of the log, so an idle client stays current.
      const cursor = hasMore ? page[page.length - 1]!.seq : last;
      return {
        epoch: this.epoch(),
        ...records,
        deleted,
        cursor,
        hasMore,
        serverTime: this.now().toISOString(),
      };
    });
  }

  /**
   * Applies a batch of offline operations in order. Each op and the record of its result commit together,
   * so a resent op is either fully applied once or not at all.
   */
  push(body: z.output<typeof C.SyncPushRequest>, sessionId: string | null, lang: Lang): SyncPushResponse {
    if (body.epoch !== this.epoch()) throw resyncNeeded('epoch-mismatch', 'errors.epochMismatch');
    const results = body.ops.map((raw) => this.applyOp(raw, sessionId, lang));
    return { epoch: this.epoch(), results, serverTime: this.now().toISOString() };
  }

  private applyOp(raw: { opId: string }, sid: string | null, lang: Lang): SyncOpResult {
    const { opId } = raw;
    const stored = this.db.select().from(appliedOps).where(eq(appliedOps.opId, opId)).get();
    if (stored) return { ...(stored.result as SyncOpResult), opId, status: 'duplicate' };
    try {
      const op = parse(SyncOp, raw, lang);
      return this.db.transaction((tx) => {
        this.execute(op, sid);
        const result: SyncOpResult = { opId, status: 'applied' };
        tx.insert(appliedOps)
          .values({ opId, sessionId: sid, type: op.type, result, at: this.now().toISOString() })
          .run();
        return result;
      });
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      // Not stored: nothing was applied, and the device resolves it with a new op.
      const message = tr(lang)(err.key, err.params);
      if (err instanceof ConflictError) {
        const { conflicts, currentVersion } = err.extra as {
          conflicts: SyncOpResult['conflicts'];
          currentVersion: number;
        };
        return { opId, status: 'conflict', code: err.code, message, conflicts, currentVersion };
      }
      return { opId, status: 'rejected', code: err.code, message };
    }
  }

  /** The same catalog operations the web uses, so validation and merging rules are identical. */
  private execute(op: z.output<typeof SyncOp>, sid: string | null): void {
    const c = this.catalog;
    switch (op.type) {
      case 'book.create':
        c.createBook(op.book, sid);
        break;
      case 'copy.create':
        c.createCopy(op.copy, sid);
        break;
      case 'location.create':
        c.createLocation(op.location, sid);
        break;
      case 'work.update':
        c.patchWork(op.id, op.patch, sid);
        break;
      case 'edition.update':
        c.patchEdition(op.id, op.patch, sid);
        break;
      case 'copy.update':
        c.patchCopy(op.id, op.patch, sid);
        break;
      case 'location.update':
        c.patchLocation(op.id, op.patch, sid);
        break;
      case 'reading.create':
        c.createReading(op.reading, sid);
        break;
      case 'reading.update':
        c.patchReading(op.id, op.patch, sid);
        break;
      case 'wish.create':
        c.createWish(op.wish, sid);
        break;
      case 'wish.update':
        c.patchWish(op.id, op.patch, sid);
        break;
    }
  }
}
