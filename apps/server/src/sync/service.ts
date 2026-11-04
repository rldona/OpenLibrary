/**
 * Sync, pull side (F2): full snapshot and incremental pull over the change log.
 *
 * The pull is state based: for every entity whose latest change is after the cursor it returns the
 * entity as it is NOW (not each intermediate change), ordered by that latest `seq`. Paging by the
 * latest seq is safe while writes keep happening: an entity changed again during paging simply
 * moves past the cursor and comes back in a later page.
 */
import { inArray, isNull, sql } from 'drizzle-orm';
import type {
  SyncCopy,
  SyncEdition,
  SyncEntity,
  SyncLocation,
  SyncPullPage,
  SyncRecords,
  SyncSnapshot,
  SyncTombstone,
  SyncWork,
} from '@openlibrary/contracts';
import type { z } from 'zod';
import type * as C from '@openlibrary/contracts';
import { getMeta, type Db } from '../db/client.js';
import { changeLog, copies, editions, locations, works } from '../db/schema.js';
import { HttpError } from '../errors.js';
import type { Clock } from '../auth/service.js';
import { TABLES, type Tx } from '../catalog/changes.js';

type WorkRow = typeof works.$inferSelect;
type EditionRow = typeof editions.$inferSelect;
type CopyRow = typeof copies.$inferSelect;
type LocationRow = typeof locations.$inferSelect;

const toWork = ({ sortTitle: _a, sortAuthor: _b, deletedAt: _c, ...w }: WorkRow): SyncWork => w;
const toEdition = ({ deletedAt: _d, ...e }: EditionRow): SyncEdition => e;
const toCopy = ({ deletedAt: _d, ...c }: CopyRow): SyncCopy => c as SyncCopy;
const toLocation = ({ deletedAt: _d, ...l }: LocationRow): SyncLocation => l;

const KEYS = { work: 'works', edition: 'editions', copy: 'copies', location: 'locations' } as const;

const resyncNeeded = (code: string, key: string) => new HttpError(409, code, key);

export class SyncService {
  constructor(
    private readonly db: Db,
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

      const records: SyncRecords = { works: [], editions: [], copies: [], locations: [] };
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
          const row = rows.get(id) as (WorkRow & EditionRow & CopyRow & LocationRow) | undefined;
          if (!row) continue;
          if (row.deletedAt) {
            deleted.push({ entity, id, version: row.version, deletedAt: row.deletedAt });
            continue;
          }
          if (entity === 'work') records.works.push(toWork(row));
          else if (entity === 'edition') records.editions.push(toEdition(row));
          else if (entity === 'copy') records.copies.push(toCopy(row));
          else records.locations.push(toLocation(row));
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
}
