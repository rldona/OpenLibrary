import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  isbn13to10,
  uuidv7,
  workReadingStatus,
  type ReadingDTO,
  type WishDTO,
  type QuoteDTO,
  type WishList,
  type CopyDTO,
  type EditionDTO,
  type LibraryFacets,
  type LibraryItem,
  type LibraryPage,
  type LocationDTO,
  type LocationTree,
  type WorkDetail,
  type WorkDTO,
} from '@openlibrary/contracts';
import type * as C from '@openlibrary/contracts';
import { getMeta, setMeta, type Db } from '../db/client.js';
import {
  assets,
  copies,
  editions,
  locations,
  quotes,
  readingSessions,
  wishlistItems,
  works,
} from '../db/schema.js';
import { badRequest, HttpError, notFound } from '../errors.js';
import type { Clock } from '../auth/service.js';
import { patchEntity, recordChange, softDelete, type Tx } from './changes.js';
import { authorSortKey, fold, ftsQuery } from './text.js';

type WorkRow = typeof works.$inferSelect;
type EditionRow = typeof editions.$inferSelect;
type CopyRow = typeof copies.$inferSelect;
type LocationRow = typeof locations.$inferSelect;
type ReadingRow = typeof readingSessions.$inferSelect;
type WishRow = typeof wishlistItems.$inferSelect;
type QuoteRow = typeof quotes.$inferSelect;
type Out<T extends z.ZodType> = z.output<T>;

export const workDerived = (w: { title: string; authors: string[] }) => ({
  sortTitle: fold(w.title),
  sortAuthor: authorSortKey(w.authors),
});

const toWork = ({ sortTitle: _a, sortAuthor: _b, deletedAt: _c, ...w }: WorkRow): WorkDTO => w;
const toReading = ({ deletedAt: _d, ...r }: ReadingRow): ReadingDTO => r;
const toWish = ({ deletedAt: _d, ...w }: WishRow): WishDTO => w;
const toQuote = ({ deletedAt: _d, ...q }: QuoteRow): QuoteDTO => q;
const PRIORITY = { high: 0, normal: 1, low: 2 } as const;

/** BR11: entering "reading" or "read" without the matching date stamps today. */
function readingDates(
  status: string | undefined,
  current: { startedOn: string | null; finishedOn: string | null },
  today: string,
) {
  const out: { startedOn?: string; finishedOn?: string } = {};
  if (status === 'reading' && !current.startedOn) out.startedOn = today;
  if (status === 'read' && !current.finishedOn) out.finishedOn = today;
  return out;
}

const toEdition = ({ deletedAt: _d, ...e }: EditionRow): EditionDTO => ({
  ...e,
  isbn10: e.isbn13 ? isbn13to10(e.isbn13) : null,
});

export class CatalogService {
  constructor(
    private readonly db: Db,
    private readonly now: Clock = () => new Date(),
  ) {}

  private ts = () => this.now().toISOString();

  // ======================= Locations (helpers) =======================
  private locationMap(tx: Tx = this.db): Map<string, LocationRow> {
    const rows = tx.select().from(locations).where(isNull(locations.deletedAt)).all();
    return new Map(rows.map((l) => [l.id, l]));
  }

  private pathOf(map: Map<string, LocationRow>, id: string | null): string[] {
    const out: string[] = [];
    let cur = id ? map.get(id) : undefined;
    for (let i = 0; cur && i < 50; i++) {
      out.unshift(cur.name);
      cur = cur.parentId ? map.get(cur.parentId) : undefined;
    }
    return out;
  }

  private subtree(map: Map<string, LocationRow>, id: string): string[] {
    const children = new Map<string, string[]>();
    for (const l of map.values()) {
      if (l.parentId) children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.id]);
    }
    const out: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      out.push(cur);
      stack.push(...(children.get(cur) ?? []));
    }
    return out;
  }

  private ensureLocation(tx: Tx, id: string | null | undefined) {
    if (!id) return;
    const l = tx
      .select({ id: locations.id, deletedAt: locations.deletedAt })
      .from(locations)
      .where(eq(locations.id, id))
      .get();
    if (!l || l.deletedAt) throw badRequest('errors.locationNotFound');
  }

  private ensureAsset(tx: Tx, id: string | null | undefined) {
    if (!id) return;
    if (!tx.select({ id: assets.id }).from(assets).where(eq(assets.id, id)).get()) {
      throw badRequest('errors.coverNotFound');
    }
  }

  // ======================= Full-text search =======================
  /** Recomputes the search row of each edition (title, authors, ISBN, publisher, subjects, locations…). */
  private reindex(tx: Tx, editionIds: Iterable<string>) {
    const map = this.locationMap(tx);
    for (const id of new Set(editionIds)) {
      tx.run(sql`DELETE FROM search_fts WHERE edition_id = ${id}`);
      const e = tx.select().from(editions).where(eq(editions.id, id)).get();
      if (!e || e.deletedAt) continue;
      const w = tx.select().from(works).where(eq(works.id, e.workId)).get();
      if (!w || w.deletedAt) continue;
      const cs = tx
        .select()
        .from(copies)
        .where(and(eq(copies.editionId, id), isNull(copies.deletedAt), eq(copies.status, 'active')))
        .all();
      const body = [
        w.title,
        w.subtitle,
        e.title,
        e.subtitle,
        w.authors.join(' '),
        w.subjects.join(' '),
        w.series,
        e.publisher,
        e.isbn13,
        e.isbn13 ? isbn13to10(e.isbn13) : null,
        ...cs.map((c) => `${c.code} ${this.pathOf(map, c.locationId).join(' ')}`),
      ]
        .filter(Boolean)
        .join('\n');
      tx.run(sql`INSERT INTO search_fts (edition_id, body) VALUES (${id}, ${body})`);
    }
  }

  private editionsInLocations(tx: Tx, locIds: string[]): string[] {
    if (!locIds.length) return [];
    return tx
      .selectDistinct({ id: copies.editionId })
      .from(copies)
      .where(and(inArray(copies.locationId, locIds), isNull(copies.deletedAt)))
      .all()
      .map((r) => r.id);
  }

  /** Rebuilds the whole index (after an import or a restore). */
  reindexAll(): void {
    this.db.transaction((tx) => {
      tx.run(sql`DELETE FROM search_fts`);
      const ids = tx.select({ id: editions.id }).from(editions).where(isNull(editions.deletedAt)).all();
      this.reindex(
        tx,
        ids.map((r) => r.id),
      );
    });
  }

  // ======================= Reads =======================
  findByIsbn(isbn13: string, tx: Tx = this.db) {
    const e = tx
      .select()
      .from(editions)
      .where(and(eq(editions.isbn13, isbn13), isNull(editions.deletedAt)))
      .get();
    if (!e) return null;
    const w = tx.select().from(works).where(eq(works.id, e.workId)).get()!;
    const n = tx
      .select({ id: copies.id })
      .from(copies)
      .where(and(eq(copies.editionId, e.id), isNull(copies.deletedAt), eq(copies.status, 'active')))
      .all().length;
    return { editionId: e.id, workId: e.workId, title: e.title ?? w.title, copies: n };
  }

  getWork(id: string, tx: Tx = this.db): WorkDetail {
    const w = tx.select().from(works).where(eq(works.id, id)).get();
    if (!w || w.deletedAt) throw notFound('errors.bookNotFound');
    const map = this.locationMap(tx);
    const eds = tx
      .select()
      .from(editions)
      .where(and(eq(editions.workId, id), isNull(editions.deletedAt)))
      .all()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const cs = eds.length
      ? tx
          .select()
          .from(copies)
          .where(
            and(
              inArray(
                copies.editionId,
                eds.map((e) => e.id),
              ),
              isNull(copies.deletedAt),
            ),
          )
          .all()
      : [];
    const readings = cs.length
      ? tx
          .select()
          .from(readingSessions)
          .where(
            and(
              inArray(
                readingSessions.copyId,
                cs.map((c) => c.id),
              ),
              isNull(readingSessions.deletedAt),
            ),
          )
          .all()
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(toReading)
      : [];
    const qs = tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.workId, id), isNull(quotes.deletedAt)))
      .all()
      .sort((a, b) => (a.page ?? Infinity) - (b.page ?? Infinity) || a.createdAt.localeCompare(b.createdAt))
      .map(toQuote);
    return {
      work: toWork(w),
      quotes: qs,
      readings,
      readingStatus: workReadingStatus(readings),
      editions: eds.map((e) => ({
        ...toEdition(e),
        copies: cs
          .filter((c) => c.editionId === e.id)
          .sort((a, b) => a.code.localeCompare(b.code))
          .map((c) => this.toCopy(c, map)),
      })),
    };
  }

  private toCopy({ deletedAt: _d, ...c }: CopyRow, map: Map<string, LocationRow>): CopyDTO {
    return { ...c, locationPath: this.pathOf(map, c.locationId) };
  }

  /** Library listing: one row per edition with active copies. */
  library(q: Out<typeof C.LibraryQuery>): LibraryPage {
    const t0 = performance.now();
    const client = this.db.$client;
    const map = this.locationMap();
    const where: string[] = ['e.deleted_at IS NULL', 'w.deleted_at IS NULL'];
    const params: unknown[] = [];

    let copyCond = "c.edition_id = e.id AND c.deleted_at IS NULL AND c.status = 'active'";
    if (q.location === 'none') copyCond += ' AND c.location_id IS NULL';
    else if (q.location) {
      if (!map.has(q.location)) throw badRequest('errors.locationNotFound');
      const ids = this.subtree(map, q.location);
      copyCond += ` AND c.location_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
    where.push(`EXISTS (SELECT 1 FROM copies c WHERE ${copyCond})`);
    if (q.q) {
      const fts = ftsQuery(q.q);
      if (fts) {
        where.push('e.id IN (SELECT edition_id FROM search_fts WHERE search_fts MATCH ?)');
        params.push(fts);
      }
    }
    if (q.subject) {
      where.push('EXISTS (SELECT 1 FROM json_each(w.subjects) WHERE value = ?)');
      params.push(q.subject);
    }
    if (q.language) {
      where.push('e.language = ?');
      params.push(q.language);
    }
    const from = `FROM editions e JOIN works w ON w.id = e.work_id WHERE ${where.join(' AND ')}`;
    const lastAcq =
      "(SELECT max(c2.acquired_on) FROM copies c2 WHERE c2.edition_id = e.id AND c2.deleted_at IS NULL AND c2.status = 'active')";
    const order = {
      title: 'w.sort_title, e.published_year, e.id',
      author: 'w.sort_author, w.sort_title, e.id',
      acquired: `${lastAcq} IS NULL, ${lastAcq} DESC, w.sort_title, e.id`,
      added: 'e.created_at DESC, e.id',
      location: 'w.sort_title, e.id',
    }[q.sort];

    const total = (client.prepare(`SELECT count(*) AS n ${from}`).get(...params) as { n: number }).n;
    const select = `SELECT e.id AS editionId, e.work_id AS workId, coalesce(e.title, w.title) AS title,
      coalesce(e.subtitle, w.subtitle) AS subtitle, w.authors, w.subjects, e.publisher, e.published_year AS publishedYear,
      e.language, e.isbn13, e.cover_asset_id AS coverAssetId, e.metadata_status AS metadataStatus ${from} ORDER BY ${order}`;

    type Row = Omit<LibraryItem, 'authors' | 'subjects' | 'copies' | 'editionCount' | 'lastAcquiredOn'> & {
      authors: string;
      subjects: string;
    };
    let rows: Row[];
    if (q.sort === 'location') {
      // Sorting by the first location's path is done in memory (paths are not stored in SQL).
      const all = client.prepare(select).all(...params) as Row[];
      const firstLoc = new Map<string, string>();
      for (const c of client
        .prepare(
          "SELECT edition_id AS e, location_id AS l FROM copies WHERE deleted_at IS NULL AND status = 'active'",
        )
        .all() as { e: string; l: string | null }[]) {
        const key = c.l ? fold(this.pathOf(map, c.l).join(' / ')) : '￿';
        const prev = firstLoc.get(c.e);
        if (prev === undefined || key < prev) firstLoc.set(c.e, key);
      }
      rows = all
        .map((r, i) => ({ r, i, k: firstLoc.get(r.editionId) ?? '￿' }))
        .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
        .slice(q.offset, q.offset + q.limit)
        .map((x) => x.r);
    } else {
      rows = client.prepare(`${select} LIMIT ? OFFSET ?`).all(...params, q.limit, q.offset) as Row[];
    }

    const edIds = rows.map((r) => r.editionId);
    const workIds = [...new Set(rows.map((r) => r.workId))];
    const ph = (n: number) => Array(n).fill('?').join(',');
    const cs = edIds.length
      ? (client
          .prepare(
            `SELECT id, code, edition_id AS editionId, location_id AS locationId, acquired_on AS acquiredOn
             FROM copies WHERE edition_id IN (${ph(edIds.length)}) AND deleted_at IS NULL AND status = 'active' ORDER BY code`,
          )
          .all(...edIds) as {
          id: string;
          code: string;
          editionId: string;
          locationId: string | null;
          acquiredOn: string | null;
        }[])
      : [];
    const edCount = new Map(
      workIds.length
        ? (
            client
              .prepare(
                `SELECT e.work_id AS w, count(*) AS n FROM editions e WHERE e.work_id IN (${ph(workIds.length)})
                 AND e.deleted_at IS NULL AND EXISTS (SELECT 1 FROM copies c WHERE c.edition_id = e.id AND c.deleted_at IS NULL AND c.status = 'active')
                 GROUP BY e.work_id`,
              )
              .all(...workIds) as { w: string; n: number }[]
          ).map((r) => [r.w, r.n])
        : [],
    );

    const items: LibraryItem[] = rows.map((r) => {
      const mine = cs.filter((c) => c.editionId === r.editionId);
      return {
        ...r,
        authors: JSON.parse(r.authors) as string[],
        subjects: JSON.parse(r.subjects) as string[],
        editionCount: edCount.get(r.workId) ?? 1,
        copies: mine.map((c) => ({
          id: c.id,
          code: c.code,
          locationId: c.locationId,
          locationPath: this.pathOf(map, c.locationId),
        })),
        lastAcquiredOn:
          mine
            .map((c) => c.acquiredOn ?? '')
            .sort()
            .pop() || null,
      };
    });
    return { items, total, tookMs: Math.round((performance.now() - t0) * 10) / 10 };
  }

  facets(): LibraryFacets {
    const client = this.db.$client;
    const owned = `FROM editions e JOIN works w ON w.id = e.work_id WHERE e.deleted_at IS NULL AND w.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM copies c WHERE c.edition_id = e.id AND c.deleted_at IS NULL AND c.status = 'active')`;
    const subjects = client
      .prepare(
        `SELECT j.value AS name, count(DISTINCT w.id) AS count ${owned.replace('WHERE', ', json_each(w.subjects) j WHERE')} GROUP BY j.value ORDER BY count DESC, name`,
      )
      .all() as { name: string; count: number }[];
    const languages = (
      client
        .prepare(`SELECT DISTINCT e.language AS l ${owned} AND e.language IS NOT NULL ORDER BY l`)
        .all() as {
        l: string;
      }[]
    ).map((r) => r.l);
    return { subjects, languages };
  }

  // ======================= Creation =======================
  private nextCopyCode(tx: Tx): string {
    const n = Number(getMeta(tx as Db, 'copy_seq') ?? '0') + 1;
    setMeta(tx as Db, 'copy_seq', String(n));
    return `EJ-${String(n).padStart(4, '0')}`;
  }

  private insertCopy(
    tx: Tx,
    editionId: string,
    c: Out<typeof C.CopyCreate> | (Out<typeof C.CopyFields> & { id?: string }),
    now: string,
    sid: string | null,
  ) {
    this.ensureLocation(tx, c.locationId);
    const id = c.id ?? uuidv7();
    if (tx.select({ id: copies.id }).from(copies).where(eq(copies.id, id)).get()) {
      throw new HttpError(409, 'already-exists', 'errors.alreadyExists.copy');
    }
    const fields = {
      editionId,
      code: this.nextCopyCode(tx),
      locationId: c.locationId ?? null,
      condition: c.condition,
      acquiredOn: c.acquiredOn ?? null,
      priceCents: c.priceCents ?? null,
      priceCurrency: c.priceCurrency,
      notes: c.notes,
      status: 'active' as const,
      retiredReason: null,
      retiredOn: null,
    };
    tx.insert(copies)
      .values({ id, version: 1, createdAt: now, updatedAt: now, ...fields })
      .run();
    recordChange(tx, 'copy', id, 'create', 1, fields, now, sid);
    return id;
  }

  /** Composite creation in one transaction: work (new or existing) + edition + copy. */
  createBook(
    input: Out<typeof C.BookCreate>,
    sid: string | null = null,
  ): WorkDetail & { created: { editionId: string; copyId: string } } {
    return this.db.transaction((tx) => {
      const now = this.ts();
      const ed = input.edition;
      if (ed.isbn13 && !input.allowDuplicateIsbn) {
        const existing = this.findByIsbn(ed.isbn13, tx);
        if (existing) {
          throw new HttpError(
            409,
            'duplicate-isbn',
            'errors.duplicateIsbn',
            { title: existing.title, n: existing.copies },
            { existing },
          );
        }
      }
      let workId = input.workId;
      if (workId) {
        const w = tx.select().from(works).where(eq(works.id, workId)).get();
        if (!w || w.deletedAt) throw badRequest('errors.workNotFound');
      } else {
        const { id, ...fields } = input.work!;
        workId = id ?? uuidv7();
        if (tx.select({ id: works.id }).from(works).where(eq(works.id, workId)).get()) {
          throw new HttpError(409, 'already-exists', 'errors.alreadyExists.work');
        }
        tx.insert(works)
          .values({
            id: workId,
            version: 1,
            createdAt: now,
            updatedAt: now,
            ...fields,
            ...workDerived(fields),
          })
          .run();
        recordChange(tx, 'work', workId, 'create', 1, fields, now, sid);
      }

      this.ensureAsset(tx, ed.coverAssetId);
      const { id: edId, ...edFields } = ed;
      const editionId = edId ?? uuidv7();
      if (tx.select({ id: editions.id }).from(editions).where(eq(editions.id, editionId)).get()) {
        throw new HttpError(409, 'already-exists', 'errors.alreadyExists.edition');
      }
      const editionValues = { workId, ...edFields };
      tx.insert(editions)
        .values({ id: editionId, version: 1, createdAt: now, updatedAt: now, ...editionValues })
        .run();
      recordChange(tx, 'edition', editionId, 'create', 1, editionValues, now, sid);

      const copyId = this.insertCopy(tx, editionId, input.copy, now, sid);
      this.reindex(tx, [editionId]);
      return { ...this.getWork(workId, tx), created: { editionId, copyId } };
    });
  }

  /** Another copy of an existing edition (without duplicating bibliographic data). */
  createCopy(
    input: Out<typeof C.CopyCreate>,
    sid: string | null = null,
  ): WorkDetail & { created: { copyId: string } } {
    return this.db.transaction((tx) => {
      const e = tx.select().from(editions).where(eq(editions.id, input.editionId)).get();
      if (!e || e.deletedAt) throw badRequest('errors.editionNotFound');
      const copyId = this.insertCopy(tx, e.id, input, this.ts(), sid);
      this.reindex(tx, [e.id]);
      return { ...this.getWork(e.workId, tx), created: { copyId } };
    });
  }

  // ======================= Updates =======================
  patchWork(id: string, p: Out<typeof C.WorkPatch>, sid: string | null = null): WorkDetail {
    return this.db.transaction((tx) => {
      patchEntity<WorkRow>(tx, 'work', id, p.baseVersion, p.fields, {
        now: this.ts(),
        sessionId: sid,
        derived: (w) => workDerived(w),
      });
      const eds = tx.select({ id: editions.id }).from(editions).where(eq(editions.workId, id)).all();
      this.reindex(
        tx,
        eds.map((e) => e.id),
      );
      return this.getWork(id, tx);
    });
  }

  patchEdition(id: string, p: Out<typeof C.EditionPatch>, sid: string | null = null): WorkDetail {
    return this.db.transaction((tx) => {
      this.ensureAsset(tx, p.fields.coverAssetId);
      const { row } = patchEntity<EditionRow>(tx, 'edition', id, p.baseVersion, p.fields, {
        now: this.ts(),
        sessionId: sid,
      });
      this.reindex(tx, [id]);
      return this.getWork(row.workId, tx);
    });
  }

  patchCopy(id: string, p: Out<typeof C.CopyPatch>, sid: string | null = null): WorkDetail {
    return this.db.transaction((tx) => {
      const fields: Record<string, unknown> = { ...p.fields };
      this.ensureLocation(tx, p.fields.locationId);
      if (p.fields.status === 'retired') {
        fields.retiredOn = this.ts().slice(0, 10);
        fields.retiredReason = p.fields.retiredReason ?? 'other';
      } else if (p.fields.status === 'active') {
        fields.retiredOn = null;
        fields.retiredReason = null;
      }
      const { row } = patchEntity<CopyRow>(tx, 'copy', id, p.baseVersion, fields, {
        now: this.ts(),
        sessionId: sid,
      });
      this.reindex(tx, [row.editionId]);
      const e = tx
        .select({ workId: editions.workId })
        .from(editions)
        .where(eq(editions.id, row.editionId))
        .get()!;
      return this.getWork(e.workId, tx);
    });
  }

  /** Deletes an edition (and its copies). If the work is left without editions, it is deleted too. */
  deleteEdition(id: string, sid: string | null = null): { workDeleted: boolean } {
    return this.db.transaction((tx) => {
      const e = tx.select().from(editions).where(eq(editions.id, id)).get();
      if (!e || e.deletedAt) throw notFound('errors.editionNotFound');
      const now = this.ts();
      for (const c of tx
        .select({ id: copies.id })
        .from(copies)
        .where(and(eq(copies.editionId, id), isNull(copies.deletedAt)))
        .all()) {
        softDelete(tx, 'copy', c.id, now, sid);
      }
      softDelete(tx, 'edition', id, now, sid);
      const rest = tx
        .select({ id: editions.id })
        .from(editions)
        .where(and(eq(editions.workId, e.workId), isNull(editions.deletedAt)))
        .all();
      if (!rest.length) softDelete(tx, 'work', e.workId, now, sid);
      this.reindex(tx, [id]);
      return { workDeleted: !rest.length };
    });
  }

  // ======================= Reading =======================
  /** Starts a session (or records one already finished) on a copy, which may be retired (BR08). */
  createReading(input: Out<typeof C.ReadingCreate>, sid: string | null = null): WorkDetail {
    return this.db.transaction((tx) => {
      const c = tx.select().from(copies).where(eq(copies.id, input.copyId)).get();
      if (!c || c.deletedAt) throw badRequest('errors.copyNotFound');
      const now = this.ts();
      const { id: maybeId, ...given } = input;
      const id = maybeId ?? uuidv7();
      if (
        tx.select({ id: readingSessions.id }).from(readingSessions).where(eq(readingSessions.id, id)).get()
      ) {
        throw new HttpError(409, 'already-exists', 'errors.alreadyExists.reading');
      }
      const fields = { ...given, ...readingDates(given.status, given, now.slice(0, 10)) };
      tx.insert(readingSessions)
        .values({ id, version: 1, createdAt: now, updatedAt: now, ...fields })
        .run();
      recordChange(tx, 'reading', id, 'create', 1, fields, now, sid);
      return this.getWork(this.workOfCopy(tx, c.editionId), tx);
    });
  }

  patchReading(id: string, p: Out<typeof C.ReadingPatch>, sid: string | null = null): WorkDetail {
    return this.db.transaction((tx) => {
      const r = tx.select().from(readingSessions).where(eq(readingSessions.id, id)).get();
      if (!r || r.deletedAt) throw notFound();
      const merged = {
        startedOn: p.fields.startedOn ?? r.startedOn,
        finishedOn: p.fields.finishedOn ?? r.finishedOn,
      };
      const fields = { ...readingDates(p.fields.status, merged, this.ts().slice(0, 10)), ...p.fields };
      patchEntity<ReadingRow>(tx, 'reading', id, p.baseVersion, fields, { now: this.ts(), sessionId: sid });
      const c = tx.select().from(copies).where(eq(copies.id, r.copyId)).get()!;
      return this.getWork(this.workOfCopy(tx, c.editionId), tx);
    });
  }

  private workOfCopy(tx: Tx, editionId: string): string {
    return tx.select({ workId: editions.workId }).from(editions).where(eq(editions.id, editionId)).get()!
      .workId;
  }

  // ======================= Quotes =======================
  createQuote(input: Out<typeof C.QuoteCreate>, sid: string | null = null): WorkDetail {
    return this.db.transaction((tx) => {
      const w = tx.select().from(works).where(eq(works.id, input.workId)).get();
      if (!w || w.deletedAt) throw badRequest('errors.workNotFound');
      this.ensureCopyOfWork(tx, input.copyId, input.workId);
      const now = this.ts();
      const { id: maybeId, ...fields } = input;
      const id = maybeId ?? uuidv7();
      if (tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, id)).get()) {
        throw new HttpError(409, 'already-exists', 'errors.alreadyExists.quote');
      }
      tx.insert(quotes)
        .values({ id, version: 1, createdAt: now, updatedAt: now, ...fields })
        .run();
      recordChange(tx, 'quote', id, 'create', 1, fields, now, sid);
      return this.getWork(input.workId, tx);
    });
  }

  patchQuote(id: string, p: Out<typeof C.QuotePatch>, sid: string | null = null): WorkDetail {
    return this.db.transaction((tx) => {
      const q = tx.select().from(quotes).where(eq(quotes.id, id)).get();
      if (!q || q.deletedAt) throw notFound();
      this.ensureCopyOfWork(tx, p.fields.copyId, q.workId);
      patchEntity<QuoteRow>(tx, 'quote', id, p.baseVersion, p.fields, { now: this.ts(), sessionId: sid });
      return this.getWork(q.workId, tx);
    });
  }

  deleteQuote(id: string, sid: string | null = null): WorkDetail {
    return this.db.transaction((tx) => {
      const q = tx.select().from(quotes).where(eq(quotes.id, id)).get();
      if (!q || q.deletedAt) throw notFound();
      softDelete(tx, 'quote', id, this.ts(), sid);
      return this.getWork(q.workId, tx);
    });
  }

  private ensureCopyOfWork(tx: Tx, copyId: string | null | undefined, workId: string) {
    if (!copyId) return;
    const c = tx.select().from(copies).where(eq(copies.id, copyId)).get();
    if (!c || c.deletedAt || this.workOfCopy(tx, c.editionId) !== workId)
      throw badRequest('errors.copyNotFound');
  }

  // ======================= Wishlist =======================
  /** Open wishes first, by priority and then newest; acquired and discarded ones after (history). */
  wishlist(): WishList {
    const items = this.db
      .select()
      .from(wishlistItems)
      .where(isNull(wishlistItems.deletedAt))
      .all()
      .sort(
        (a, b) =>
          Number(a.status !== 'open') - Number(b.status !== 'open') ||
          PRIORITY[a.priority] - PRIORITY[b.priority] ||
          b.createdAt.localeCompare(a.createdAt),
      )
      .map(toWish);
    return { items };
  }

  createWish(input: Out<typeof C.WishCreate>, sid: string | null = null): WishDTO {
    return this.db.transaction((tx) => {
      this.ensureWishLinks(tx, input);
      const now = this.ts();
      const { id: maybeId, ...fields } = input;
      const id = maybeId ?? uuidv7();
      if (tx.select({ id: wishlistItems.id }).from(wishlistItems).where(eq(wishlistItems.id, id)).get()) {
        throw new HttpError(409, 'already-exists', 'errors.alreadyExists.wish');
      }
      tx.insert(wishlistItems)
        .values({ id, version: 1, createdAt: now, updatedAt: now, ...fields })
        .run();
      recordChange(tx, 'wish', id, 'create', 1, fields, now, sid);
      return toWish(tx.select().from(wishlistItems).where(eq(wishlistItems.id, id)).get()!);
    });
  }

  patchWish(id: string, p: Out<typeof C.WishPatch>, sid: string | null = null): WishDTO {
    return this.db.transaction((tx) => {
      this.ensureWishLinks(tx, p.fields);
      const { row } = patchEntity<WishRow>(tx, 'wish', id, p.baseVersion, p.fields, {
        now: this.ts(),
        sessionId: sid,
      });
      return toWish(row);
    });
  }

  private ensureWishLinks(tx: Tx, f: { workId?: string | null; acquiredCopyId?: string | null }) {
    if (f.workId) {
      const w = tx.select().from(works).where(eq(works.id, f.workId)).get();
      if (!w || w.deletedAt) throw badRequest('errors.workNotFound');
    }
    if (f.acquiredCopyId) {
      const c = tx.select().from(copies).where(eq(copies.id, f.acquiredCopyId)).get();
      if (!c || c.deletedAt) throw badRequest('errors.copyNotFound');
    }
  }

  // ======================= Locations =======================
  locationTree(): LocationTree {
    const map = this.locationMap();
    const counts = new Map<string | null, number>();
    for (const r of this.db.$client
      .prepare(
        "SELECT location_id AS l, count(*) AS n FROM copies WHERE deleted_at IS NULL AND status = 'active' GROUP BY location_id",
      )
      .all() as { l: string | null; n: number }[]) {
      counts.set(r.l, r.n);
    }
    const deep = new Map<string, number>();
    for (const [locId, n] of counts) {
      let cur = locId ? map.get(locId) : undefined;
      for (let i = 0; cur && i < 50; i++) {
        deep.set(cur.id, (deep.get(cur.id) ?? 0) + n);
        cur = cur.parentId ? map.get(cur.parentId) : undefined;
      }
    }
    const items: LocationDTO[] = [...map.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es', { numeric: true }))
      .map(({ deletedAt: _d, ...l }) => ({
        ...l,
        copyCount: deep.get(l.id) ?? 0,
        directCount: counts.get(l.id) ?? 0,
      }));
    return { items, unassigned: counts.get(null) ?? 0 };
  }

  createLocation(input: Out<typeof C.LocationCreate>, sid: string | null = null): LocationTree {
    this.db.transaction((tx) => {
      this.ensureLocation(tx, input.parentId);
      const now = this.ts();
      const { id: maybeId, ...fields } = input;
      const id = maybeId ?? uuidv7();
      if (tx.select({ id: locations.id }).from(locations).where(eq(locations.id, id)).get()) {
        throw new HttpError(409, 'already-exists', 'errors.alreadyExists.location');
      }
      tx.insert(locations)
        .values({ id, version: 1, createdAt: now, updatedAt: now, ...fields })
        .run();
      recordChange(tx, 'location', id, 'create', 1, fields, now, sid);
    });
    return this.locationTree();
  }

  patchLocation(id: string, p: Out<typeof C.LocationPatch>, sid: string | null = null): LocationTree {
    this.db.transaction((tx) => {
      const map = this.locationMap(tx);
      if (p.fields.parentId !== undefined && p.fields.parentId !== null) {
        if (!map.has(p.fields.parentId)) throw badRequest('errors.parentNotFound');
        if (this.subtree(map, id).includes(p.fields.parentId)) {
          throw badRequest('errors.locationCycle');
        }
      }
      const { applied } = patchEntity<LocationRow>(tx, 'location', id, p.baseVersion, p.fields, {
        now: this.ts(),
        sessionId: sid,
      });
      if ('name' in applied || 'parentId' in applied) {
        this.reindex(tx, this.editionsInLocations(tx, this.subtree(this.locationMap(tx), id)));
      }
    });
    return this.locationTree();
  }

  deleteLocation(id: string, sid: string | null = null): LocationTree {
    this.db.transaction((tx) => {
      const map = this.locationMap(tx);
      if (!map.has(id)) throw notFound('errors.locationNotFound');
      if ([...map.values()].some((l) => l.parentId === id)) {
        throw new HttpError(409, 'location-not-empty', 'errors.locationHasChildren');
      }
      const inside = tx
        .select({ id: copies.id })
        .from(copies)
        .where(and(eq(copies.locationId, id), isNull(copies.deletedAt), eq(copies.status, 'active')))
        .all();
      if (inside.length) {
        throw new HttpError(409, 'location-not-empty', 'errors.locationHasCopies', { n: inside.length });
      }
      softDelete(tx, 'location', id, this.ts(), sid);
    });
    return this.locationTree();
  }
}
