/** Full export (zip with library.json and covers) and CSV export (one row per copy). */
import fs from 'node:fs';
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import { isNull } from 'drizzle-orm';
import {
  CSV_COLUMNS,
  CSV_LIST_SEPARATOR,
  CSV_PATH_SEPARATOR,
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  type LibraryExport,
} from '@openlibrary/contracts';
import type { Db } from '../db/client.js';
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
import type { AssetService } from '../assets/service.js';
import { toCsv } from './csv.js';

/** Drops what is bookkeeping of this installation (version, tombstone, derived sort keys). */
const strip = <T extends { version: number; deletedAt: string | null }>({
  version: _v,
  deletedAt: _d,
  ...rest
}: T) => rest;

export class ExportService {
  constructor(
    private readonly db: Db,
    private readonly assetFiles: AssetService,
    private readonly appVersion: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every live record, read in one transaction so relations are consistent. */
  library(): LibraryExport {
    return this.db.transaction((tx) => {
      const live = <T extends typeof works | typeof editions | typeof copies>(t: T) =>
        tx.select().from(t).where(isNull(t.deletedAt)).orderBy(t.id).all();
      const eds = live(editions).map(strip);
      const used = new Set(eds.map((e) => e.coverAssetId).filter(Boolean));
      return {
        format: EXPORT_FORMAT,
        format_version: EXPORT_FORMAT_VERSION,
        exportedAt: this.now().toISOString(),
        app_version: this.appVersion,
        works: live(works).map(({ sortTitle: _a, sortAuthor: _b, ...w }) => strip(w)),
        editions: eds,
        copies: live(copies).map(strip) as LibraryExport['copies'],
        locations: tx
          .select()
          .from(locations)
          .where(isNull(locations.deletedAt))
          .orderBy(locations.id)
          .all()
          .map(strip),
        reading_sessions: tx
          .select()
          .from(readingSessions)
          .where(isNull(readingSessions.deletedAt))
          .orderBy(readingSessions.id)
          .all()
          .map(strip),
        quotes: tx.select().from(quotes).where(isNull(quotes.deletedAt)).orderBy(quotes.id).all().map(strip),
        wishlist: tx
          .select()
          .from(wishlistItems)
          .where(isNull(wishlistItems.deletedAt))
          .orderBy(wishlistItems.id)
          .all()
          .map(strip),
        assets: tx
          .select()
          .from(assets)
          .orderBy(assets.id)
          .all()
          .filter((a) => used.has(a.id) && fs.existsSync(this.assetFiles.pathOf(a.id, 'full')))
          .map(({ id, mime, width, height, bytes }) => ({ id, mime, width, height, bytes })),
      };
    });
  }

  /** The zip, produced file by file so a large library never sits whole in memory. */
  async *zip(): AsyncGenerator<Uint8Array> {
    const data = this.library();
    const out: Uint8Array[] = [];
    let failure: Error | null = null;
    const zip = new Zip((err, chunk) => {
      if (err) failure = err;
      else out.push(chunk);
    });
    const json = new ZipDeflate('library.json', { level: 6 });
    zip.add(json);
    json.push(strToU8(JSON.stringify(data, null, 1)), true);
    yield* out.splice(0);
    for (const a of data.assets) {
      // JPEGs are already compressed: stored as they are.
      const file = new ZipPassThrough(`assets/${a.id}.jpg`);
      zip.add(file);
      file.push(await fs.promises.readFile(this.assetFiles.pathOf(a.id, 'full')), true);
      if (failure) throw failure;
      yield* out.splice(0);
    }
    zip.end();
    if (failure) throw failure;
    yield* out.splice(0);
  }

  csv(): string {
    const data = this.library();
    const workById = new Map(data.works.map((w) => [w.id, w]));
    const edById = new Map(data.editions.map((e) => [e.id, e]));
    const locById = new Map(data.locations.map((l) => [l.id, l]));
    const path = (id: string | null) => {
      const names: string[] = [];
      for (let cur = id ? locById.get(id) : undefined, i = 0; cur && i < 50; i++) {
        names.unshift(cur.name);
        cur = cur.parentId ? locById.get(cur.parentId) : undefined;
      }
      return names.join(CSV_PATH_SEPARATOR);
    };
    // The latest session of each copy says how it stands (a re-read counts as its last state).
    const latest = new Map<string, (typeof data.reading_sessions)[number]>();
    for (const r of [...data.reading_sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      latest.set(r.copyId, r);
    }
    const rows = data.copies
      .map((c) => ({ c, e: edById.get(c.editionId)!, r: latest.get(c.id) }))
      .filter(({ e }) => e && workById.has(e.workId))
      .map(({ c, e, r }) => ({ c, e, w: workById.get(e.workId)!, r }))
      .sort((a, b) => a.c.code.localeCompare(b.c.code))
      .map(({ c, e, w, r }) => {
        const row: Record<(typeof CSV_COLUMNS)[number], unknown> = {
          code: c.code,
          title: w.title,
          subtitle: w.subtitle,
          authors: w.authors.join(CSV_LIST_SEPARATOR),
          isbn13: e.isbn13,
          publisher: e.publisher,
          published_year: e.publishedYear,
          language: e.language,
          pages: e.pages,
          format: e.format,
          subjects: w.subjects.join(CSV_LIST_SEPARATOR),
          series: w.series,
          series_index: w.seriesIndex,
          location: path(c.locationId),
          condition: c.condition,
          acquired_on: c.acquiredOn,
          price: c.priceCents === null ? null : (c.priceCents / 100).toFixed(2),
          currency: c.priceCurrency,
          status: c.status,
          retired_reason: c.retiredReason,
          notes: c.notes,
          reading_status: r?.status ?? 'pending',
          rating: r?.rating ?? null,
          work_id: w.id,
          edition_id: e.id,
          copy_id: c.id,
        };
        return CSV_COLUMNS.map((k) => row[k]);
      });
    return toCsv(CSV_COLUMNS, rows);
  }
}
