/**
 * Import of our own formats (design A9): the full export (zip or library.json) and the CSV export.
 *
 * Rules, the same in the dry run and the real import (the dry run rolls the transaction back):
 *  - A record whose id is already in the library is a duplicate and is skipped (importing the same file
 *    twice changes nothing).
 *  - An edition whose ISBN is already in the library is a duplicate too; its copies, readings and quotes go
 *    to the existing edition and work, so nothing is duplicated and nothing is lost.
 *  - A record that fails validation, or needs a record that is neither in the file nor in the library, is
 *    invalid. Optional links to something missing (a location, a cover…) are dropped with a warning.
 *  - Ids, dates, copy codes and statuses are kept. A copy code already taken gets a new one (warning).
 *  - Every created record goes to the change log, so devices receive it in their next pull.
 */
import { unzipSync } from 'fflate';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  CopyFields,
  CSV_LIST_SEPARATOR,
  CSV_PATH_SEPARATOR,
  EditionFields,
  ExportCopy,
  ExportEdition,
  ExportFile,
  ExportLocation,
  ExportQuote,
  ExportReading,
  ExportWish,
  ExportWork,
  Id,
  IMPORT_ENTITIES,
  IMPORT_ISSUES_MAX,
  READING_STATUSES,
  ReadingFields,
  RETIRE_REASONS,
  SHA256_RE,
  uuidv7,
  WorkFields,
  type ImportEntity,
  type ImportIssue,
  type ImportReport,
  type Lang,
  type Params,
} from '@openlibrary/contracts';
import { getMeta, setMeta, type Db } from '../db/client.js';
import { assets, copies, editions, locations, works } from '../db/schema.js';
import { badRequest } from '../errors.js';
import { tr } from '../i18n.js';
import type { AssetService } from '../assets/service.js';
import { recordChange, TABLES, type EntityName, type Tx } from '../catalog/changes.js';
import { workDerived, type CatalogService } from '../catalog/service.js';
import { authorSortKey, fold } from '../catalog/text.js';
import { parseCsv } from './csv.js';

const ZOD_LOCALES = { en: z.locales.en(), es: z.locales.es() } as const;
class Rollback extends Error {}

type AssetRow = typeof assets.$inferInsert;
type Source = ImportReport['source'];

/** Collects counts and issues, and validates records with translated messages. */
class Report {
  readonly counts = Object.fromEntries(
    IMPORT_ENTITIES.map((e) => [e, { created: 0, duplicates: 0, invalid: 0 }]),
  ) as ImportReport['counts'];
  readonly issues: ImportIssue[] = [];
  total = 0;
  private readonly t: ReturnType<typeof tr>;

  constructor(private readonly lang: Lang) {
    this.t = tr(lang);
  }

  add(
    kind: ImportIssue['kind'],
    entity: ImportEntity,
    row: number,
    rec: { id?: unknown; label?: unknown },
    key: string,
    params: Params = {},
  ) {
    if (kind === 'duplicate') this.counts[entity].duplicates++;
    if (kind === 'invalid') this.counts[entity].invalid++;
    this.total++;
    if (this.issues.length >= IMPORT_ISSUES_MAX) return;
    this.issues.push({
      kind,
      entity,
      row,
      id: typeof rec.id === 'string' ? rec.id : null,
      label: typeof rec.label === 'string' && rec.label ? rec.label.slice(0, 120) : null,
      message: this.t(key, params),
    });
  }

  created(entity: ImportEntity) {
    this.counts[entity].created++;
  }

  /** Validates one record; on failure reports it as invalid and returns null. */
  parse<S extends z.ZodType>(
    schema: S,
    value: unknown,
    entity: ImportEntity,
    row: number,
    label: unknown,
  ): z.output<S> | null {
    const r = schema.safeParse(value, { error: ZOD_LOCALES[this.lang].localeError });
    if (r.success) return r.data;
    const id = (value as { id?: unknown } | null)?.id;
    const details = r.error.issues.map((i) => `${i.path.join('.') || '·'}: ${this.t(i.message)}`).join('; ');
    this.add('invalid', entity, row, { id, label }, 'import.invalid', { details });
    return null;
  }

  result(dryRun: boolean, source: Source): ImportReport {
    return { dryRun, source, counts: this.counts, issues: this.issues, issuesTotal: this.total };
  }
}

export class ImportService {
  constructor(
    private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly assetFiles: AssetService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Detects the format from the content: zip, library.json or CSV. */
  async run(
    buf: Buffer,
    opts: { dryRun: boolean; lang: Lang; sessionId: string | null },
  ): Promise<ImportReport> {
    if (!buf.length) throw badRequest('errors.importEmpty');
    if (buf[0] === 0x50 && buf[1] === 0x4b) return this.fromZip(buf, opts);
    const text = buf.toString('utf8').replace(/^\uFEFF/, '');
    if (text.trimStart().startsWith('{')) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw badRequest('errors.importUnreadable');
      }
      return this.fromLibrary(json, new Map(), 'json', opts);
    }
    if (text.includes('\u0000')) throw badRequest('errors.importUnreadable');
    return this.fromCsv(text, opts);
  }

  private async fromZip(buf: Buffer, opts: { dryRun: boolean; lang: Lang; sessionId: string | null }) {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(buf, {
        filter: (f) => f.name === 'library.json' || /^assets\/[0-9a-f]{64}\.jpg$/.test(f.name),
      });
    } catch {
      throw badRequest('errors.importUnreadable');
    }
    const lib = files['library.json'];
    if (!lib) throw badRequest('errors.importNoLibrary');
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(lib).toString('utf8'));
    } catch {
      throw badRequest('errors.importUnreadable');
    }
    const images = new Map<string, Buffer>();
    for (const [name, data] of Object.entries(files)) {
      if (name.startsWith('assets/')) images.set(name.slice(7, -4), Buffer.from(data));
    }
    return this.fromLibrary(json, images, 'zip', opts);
  }

  // ======================= library.json =======================
  private async fromLibrary(
    json: unknown,
    images: Map<string, Buffer>,
    source: Source,
    opts: { dryRun: boolean; lang: Lang; sessionId: string | null },
  ): Promise<ImportReport> {
    const t = tr(opts.lang);
    const top = ExportFile.safeParse(json, { error: ZOD_LOCALES[opts.lang].localeError });
    if (!top.success) {
      throw badRequest('errors.importFormat', {
        details: top.error.issues.map((i) => t(i.message)).join('; '),
      });
    }
    const file = top.data;
    const report = new Report(opts.lang);

    // Covers first: checking (and, for real, writing) images is asynchronous; the database part is not.
    const newAssets: AssetRow[] = [];
    let row = 0;
    for (const [id, data] of images) {
      row++;
      if (!SHA256_RE.test(id)) continue;
      if (this.db.select({ id: assets.id }).from(assets).where(eq(assets.id, id)).get()) {
        report.add('duplicate', 'assets', row, { id }, 'import.duplicateId');
        continue;
      }
      const asset = await this.assetFiles.importFile(id, data, !opts.dryRun);
      if (!asset) report.add('invalid', 'assets', row, { id }, 'import.imageInvalid');
      else newAssets.push(asset);
    }

    return this.transaction(opts.dryRun, () => {
      const tx = this.db;
      const now = this.now().toISOString();
      const sid = opts.sessionId;
      const ins = new Inserter(tx, now, sid);

      for (const a of newAssets) {
        tx.insert(assets).values(a).run();
        report.created('assets');
      }
      const coverOk = (id: string | null) =>
        !id || !!tx.select({ id: assets.id }).from(assets).where(eq(assets.id, id)).get();

      // ---- Locations: parents before children; a missing or circular parent puts it at the top level.
      const locs = new Map<string, { row: number; v: z.output<typeof ExportLocation> }>();
      file.locations.forEach((raw, i) => {
        const v = report.parse(ExportLocation, raw, 'locations', i + 1, label(raw, 'name'));
        if (!v) return;
        if (ins.exists('location', v.id) || locs.has(v.id)) {
          report.add('duplicate', 'locations', i + 1, { id: v.id, label: v.name }, 'import.duplicateId');
        } else locs.set(v.id, { row: i + 1, v });
      });
      const placed = new Set<string>();
      let progress = true;
      while (locs.size && progress) {
        progress = false;
        for (const [id, { v }] of locs) {
          const p = v.parentId;
          if (p && !placed.has(p) && !ins.live('location', p) && locs.has(p)) continue;
          ins.location(v, p && (placed.has(p) || ins.live('location', p)) ? p : null);
          if (p && !placed.has(p) && !ins.live('location', p)) {
            report.add(
              'warning',
              'locations',
              locs.get(id)!.row,
              { id, label: v.name },
              'import.parentMissing',
            );
          }
          report.created('locations');
          placed.add(id);
          locs.delete(id);
          progress = true;
        }
      }
      for (const [id, { row: r, v }] of locs) {
        // Only cycles are left.
        ins.location(v, null);
        report.add('warning', 'locations', r, { id, label: v.name }, 'import.parentMissing');
        report.created('locations');
        placed.add(id);
      }

      // ---- Works and editions. A new work is only created if at least one of its editions is new.
      const newWorks = new Map<string, { row: number; v: z.output<typeof ExportWork> }>();
      file.works.forEach((raw, i) => {
        const v = report.parse(ExportWork, raw, 'works', i + 1, label(raw, 'title'));
        if (!v) return;
        if (ins.exists('work', v.id) || newWorks.has(v.id)) {
          report.add('duplicate', 'works', i + 1, { id: v.id, label: v.title }, 'import.duplicateId');
        } else newWorks.set(v.id, { row: i + 1, v });
      });
      const workMap = new Map<string, string>(); // work id in the file → work id in the library
      const editionMap = new Map<string, string>();
      const newEditions: { row: number; v: z.output<typeof ExportEdition> }[] = [];
      file.editions.forEach((raw, i) => {
        const v = report.parse(
          ExportEdition,
          raw,
          'editions',
          i + 1,
          label(raw, 'title') ?? label(raw, 'isbn13'),
        );
        if (!v) return;
        const lbl = { id: v.id, label: v.title ?? newWorks.get(v.workId)?.v.title ?? v.isbn13 };
        if (ins.exists('edition', v.id) || editionMap.has(v.id)) {
          if (ins.live('edition', v.id)) editionMap.set(v.id, v.id);
          return report.add('duplicate', 'editions', i + 1, lbl, 'import.duplicateId');
        }
        if (!newWorks.has(v.workId) && !ins.live('work', v.workId)) {
          return report.add('invalid', 'editions', i + 1, lbl, 'import.missingWork');
        }
        const same = v.isbn13 ? ins.editionByIsbn(v.isbn13) : null;
        if (same) {
          editionMap.set(v.id, same.id);
          if (newWorks.has(v.workId) && !workMap.has(v.workId)) workMap.set(v.workId, same.workId);
          return report.add('duplicate', 'editions', i + 1, lbl, 'import.duplicateIsbn', { isbn: v.isbn13! });
        }
        editionMap.set(v.id, v.id);
        newEditions.push({ row: i + 1, v });
      });
      const worksWithNewEditions = new Set(newEditions.map((e) => e.v.workId));
      for (const [id, { row: r, v }] of newWorks) {
        if (worksWithNewEditions.has(id)) {
          ins.work(v);
          workMap.set(id, id);
          report.created('works');
        } else if (workMap.has(id)) {
          report.add('duplicate', 'works', r, { id, label: v.title }, 'import.workMerged');
        } else {
          report.add('invalid', 'works', r, { id, label: v.title }, 'import.workWithoutEditions');
        }
      }
      for (const { row: r, v } of newEditions) {
        if (!coverOk(v.coverAssetId)) {
          report.add(
            'warning',
            'editions',
            r,
            { id: v.id, label: v.title ?? v.isbn13 },
            'import.coverMissing',
          );
          v.coverAssetId = null;
        }
        ins.edition(v);
        report.created('editions');
      }
      const workOf = (id: string) => workMap.get(id) ?? (ins.live('work', id) ? id : null);

      // ---- Copies. Codes are kept; the sequence moves past the highest imported one first.
      const codes = file.copies.map(
        (c) => /^EJ-(\d+)$/.exec(String((c as { code?: unknown })?.code ?? ''))?.[1],
      );
      ins.bumpCopySeq(Math.max(0, ...codes.map(Number).filter(Number.isFinite)));
      const copyIds = new Set<string>();
      file.copies.forEach((raw, i) => {
        const v = report.parse(ExportCopy, raw, 'copies', i + 1, label(raw, 'code'));
        if (!v) return;
        const lbl = { id: v.id, label: v.code };
        if (ins.exists('copy', v.id) || copyIds.has(v.id)) {
          return report.add('duplicate', 'copies', i + 1, lbl, 'import.duplicateId');
        }
        const editionId =
          editionMap.get(v.editionId) ?? (ins.live('edition', v.editionId) ? v.editionId : null);
        if (!editionId) return report.add('invalid', 'copies', i + 1, lbl, 'import.missingEdition');
        if (v.locationId && !ins.live('location', v.locationId)) {
          report.add('warning', 'copies', i + 1, lbl, 'import.locationMissing');
          v.locationId = null;
        }
        if (ins.codeTaken(v.code)) {
          const code = ins.nextCode();
          report.add('warning', 'copies', i + 1, lbl, 'import.codeTaken', { code: v.code, newCode: code });
          v.code = code;
        }
        ins.copy({ ...v, editionId });
        copyIds.add(v.id);
        report.created('copies');
      });

      // ---- Readings, quotes and wishes.
      file.reading_sessions.forEach((raw, i) => {
        const v = report.parse(ExportReading, raw, 'readings', i + 1, null);
        if (!v) return;
        if (ins.exists('reading', v.id))
          return report.add('duplicate', 'readings', i + 1, v, 'import.duplicateId');
        if (!ins.live('copy', v.copyId))
          return report.add('invalid', 'readings', i + 1, v, 'import.missingCopy');
        ins.reading(v);
        report.created('readings');
      });
      file.quotes.forEach((raw, i) => {
        const v = report.parse(ExportQuote, raw, 'quotes', i + 1, label(raw, 'text'));
        if (!v) return;
        const lbl = { id: v.id, label: v.text };
        if (ins.exists('quote', v.id))
          return report.add('duplicate', 'quotes', i + 1, lbl, 'import.duplicateId');
        const workId = workOf(v.workId);
        if (!workId) return report.add('invalid', 'quotes', i + 1, lbl, 'import.missingWork');
        if (v.copyId && !ins.live('copy', v.copyId)) {
          report.add('warning', 'quotes', i + 1, lbl, 'import.copyLinkDropped');
          v.copyId = null;
        }
        ins.quote({ ...v, workId });
        report.created('quotes');
      });
      file.wishlist.forEach((raw, i) => {
        const v = report.parse(ExportWish, raw, 'wishes', i + 1, label(raw, 'title'));
        if (!v) return;
        const lbl = { id: v.id, label: v.title };
        // Discarded wishes are deleted now, so an old export does not bring them back.
        if (v.status === 'discarded')
          return report.add('warning', 'wishes', i + 1, lbl, 'import.discardedWishSkipped');
        if (ins.exists('wish', v.id))
          return report.add('duplicate', 'wishes', i + 1, lbl, 'import.duplicateId');
        if (v.workId) {
          const w = workOf(v.workId);
          if (!w) report.add('warning', 'wishes', i + 1, lbl, 'import.workLinkDropped');
          v.workId = w;
        }
        if (!coverOk(v.coverAssetId)) {
          report.add('warning', 'wishes', i + 1, lbl, 'import.coverMissing');
          v.coverAssetId = null;
        }
        if (v.acquiredCopyId && !ins.live('copy', v.acquiredCopyId)) {
          report.add('warning', 'wishes', i + 1, lbl, 'import.copyLinkDropped');
          v.acquiredCopyId = null;
        }
        ins.wish(v);
        report.created('wishes');
      });
      return report.result(opts.dryRun, source);
    });
  }

  // ======================= CSV (one row per copy) =======================
  private fromCsv(text: string, opts: { dryRun: boolean; lang: Lang; sessionId: string | null }) {
    const rows = parseCsv(text);
    const header = rows.shift()?.cells.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_')) ?? [];
    if (!header.includes('title')) throw badRequest('errors.importCsvHeader');
    const report = new Report(opts.lang);

    return this.transaction(opts.dryRun, () => {
      const tx = this.db;
      const ins = new Inserter(tx, this.now().toISOString(), opts.sessionId);
      const newWorks = new Map<string, string>(); // key → id, for works created by this file
      const newEditions = new Map<string, string>();
      const seen = { copies: new Set<string>(), codes: new Set<string>() };
      const codes = rows.map((r) => /^EJ-(\d+)$/.exec(r.cells[header.indexOf('code')]?.trim() ?? '')?.[1]);
      ins.bumpCopySeq(Math.max(0, ...codes.map(Number).filter(Number.isFinite)));

      for (const { line, cells } of rows) {
        const get = (k: string) => {
          const i = header.indexOf(k);
          const v = i < 0 ? '' : (cells[i] ?? '').trim();
          return v === '' ? null : v;
        };
        const list = (k: string) =>
          (get(k) ?? '')
            .split(CSV_LIST_SEPARATOR.trim())
            .map((s) => s.trim())
            .filter(Boolean);
        const title = get('title');
        const code = get('code');
        const copyId = get('copy_id');
        const lbl = { id: copyId, label: title ?? code };

        if (
          (copyId && (ins.exists('copy', copyId) || seen.copies.has(copyId))) ||
          (code && seen.codes.has(code))
        ) {
          report.add('duplicate', 'copies', line, lbl, 'import.duplicateId');
          continue;
        }
        if (code && ins.codeTaken(code)) {
          report.add('duplicate', 'copies', line, lbl, 'import.duplicateCode', { code });
          continue;
        }
        const nums: Record<string, number | null> = {};
        let bad: string | null = null;
        for (const k of ['published_year', 'pages', 'series_index', 'price', 'rating']) {
          const raw = get(k);
          const n = raw === null ? null : Number(raw.replace(',', '.'));
          if (n !== null && !Number.isFinite(n)) bad ??= `${k}: "${raw}"`;
          nums[k] = n;
        }
        if (bad) {
          report.add('invalid', 'copies', line, lbl, 'import.notANumber', { value: bad });
          continue;
        }
        const work = report.parse(
          WorkFields,
          {
            title: title ?? '',
            subtitle: get('subtitle'),
            authors: list('authors'),
            subjects: list('subjects'),
            series: get('series'),
            seriesIndex: nums.series_index,
          },
          'copies',
          line,
          title,
        );
        const edition =
          work &&
          report.parse(
            EditionFields,
            {
              publisher: get('publisher'),
              publishedYear: nums.published_year,
              language: get('language'),
              pages: nums.pages,
              format: get('format'),
              isbn13: get('isbn13'),
            },
            'copies',
            line,
            title,
          );
        const status = get('status') ?? 'active';
        const reason = get('retired_reason');
        const copy =
          edition &&
          report.parse(
            CopyFields.extend({
              id: Id.optional(),
              status: z.enum(['active', 'retired']),
              retiredReason: z.enum(RETIRE_REASONS).nullable(),
            }),
            {
              id: copyId ?? undefined,
              condition: get('condition') ?? undefined,
              acquiredOn: get('acquired_on'),
              priceCents: nums.price == null ? null : Math.round(nums.price * 100),
              priceCurrency: get('currency')?.toUpperCase() ?? undefined,
              notes: get('notes') ?? '',
              status,
              retiredReason: status === 'retired' ? (reason ?? 'other') : null,
            },
            'copies',
            line,
            title,
          );
        if (!work || !edition || !copy) continue;

        // Which edition: by id, then by ISBN, in the library or earlier in this file.
        const edId = get('edition_id');
        const workKey = get('work_id') ?? `${fold(work.title)}|${authorSortKey(work.authors)}`;
        const edKey =
          edId ??
          (edition.isbn13
            ? `isbn:${edition.isbn13}`
            : `${workKey}|${fold(edition.publisher)}|${edition.publishedYear ?? ''}`);
        let editionId = (edId && ins.live('edition', edId) ? edId : null) ?? newEditions.get(edKey) ?? null;
        const existingByIsbn = !editionId && edition.isbn13 ? ins.editionByIsbn(edition.isbn13) : null;
        const existingWork =
          (get('work_id') && ins.live('work', get('work_id')!) ? get('work_id') : null) ??
          ins.workByKeys(fold(work.title), authorSortKey(work.authors));
        const inLibrary =
          (editionId && !newEditions.has(edKey)) ||
          existingByIsbn ||
          (!edition.isbn13 && existingWork && !newWorks.has(workKey));
        if (inLibrary && !copyId && !code) {
          // Without a copy id or code a row cannot say it is another copy: it is taken as the same book.
          report.add('duplicate', 'copies', line, lbl, 'import.bookExists');
          continue;
        }
        editionId ??= existingByIsbn?.id ?? null;
        if (!editionId) {
          let workId = newWorks.get(workKey) ?? existingWork ?? null;
          if (!workId) {
            workId = get('work_id') && !ins.exists('work', get('work_id')!) ? get('work_id')! : uuidv7();
            ins.work({ id: workId, ...work });
            newWorks.set(workKey, workId);
            report.created('works');
          }
          editionId = edId && !ins.exists('edition', edId) ? edId : uuidv7();
          ins.edition({ id: editionId, workId, ...edition });
          newEditions.set(edKey, editionId);
          report.created('editions');
        }

        const locationId = ins.locationPath(get('location'), () => report.created('locations'));
        const id = copy.id ?? uuidv7();
        ins.copy({
          ...copy,
          id,
          editionId,
          code: code ?? ins.nextCode(),
          retiredOn: null,
          locationId,
        });
        seen.copies.add(id);
        if (code) seen.codes.add(code);
        report.created('copies');

        const rs = get('reading_status');
        if (rs && rs !== 'pending') {
          const reading = report.parse(
            ReadingFields.extend({ status: z.enum(READING_STATUSES) }),
            { status: rs, rating: nums.rating },
            'readings',
            line,
            title,
          );
          if (reading) {
            ins.reading({ id: uuidv7(), copyId: id, ...reading });
            report.created('readings');
          }
        }
      }
      return report.result(opts.dryRun, 'csv');
    });
  }

  /** Runs the import in one transaction; the dry run rolls it back after computing the report. */
  private transaction(dryRun: boolean, fn: () => ImportReport): ImportReport {
    let report: ImportReport | null = null;
    try {
      this.db.transaction(() => {
        report = fn();
        if (dryRun) throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    if (!dryRun) this.catalog.reindexAll();
    return report!;
  }
}

const label = (raw: unknown, key: string): string | null => {
  const v = (raw as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' ? v : null;
};

/** Inserts records as they are (ids, dates, codes) and logs them as created. */
class Inserter {
  constructor(
    private readonly tx: Tx,
    private readonly now: string,
    private readonly sid: string | null,
  ) {}

  /** The id is used, by a live record or a tombstone. */
  exists(entity: EntityName, id: string): boolean {
    const t = TABLES[entity];
    return !!this.tx.select({ id: t.id }).from(t).where(eq(t.id, id)).get();
  }

  live(entity: EntityName, id: string): boolean {
    const t = TABLES[entity];
    return !!this.tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.id, id), isNull(t.deletedAt)))
      .get();
  }

  editionByIsbn(isbn13: string) {
    return this.tx
      .select({ id: editions.id, workId: editions.workId })
      .from(editions)
      .where(and(eq(editions.isbn13, isbn13), isNull(editions.deletedAt)))
      .get();
  }

  workByKeys(sortTitle: string, sortAuthor: string): string | null {
    return (
      this.tx
        .select({ id: works.id })
        .from(works)
        .where(and(eq(works.sortTitle, sortTitle), eq(works.sortAuthor, sortAuthor), isNull(works.deletedAt)))
        .get()?.id ?? null
    );
  }

  codeTaken(code: string): boolean {
    return !!this.tx.select({ id: copies.id }).from(copies).where(eq(copies.code, code)).get();
  }

  bumpCopySeq(n: number) {
    if (n > Number(getMeta(this.tx as Db, 'copy_seq') ?? '0')) setMeta(this.tx as Db, 'copy_seq', String(n));
  }

  nextCode(): string {
    for (;;) {
      const n = Number(getMeta(this.tx as Db, 'copy_seq') ?? '0') + 1;
      setMeta(this.tx as Db, 'copy_seq', String(n));
      const code = `EJ-${String(n).padStart(4, '0')}`;
      if (!this.codeTaken(code)) return code;
    }
  }

  private put<T extends { id: string; createdAt?: string; updatedAt?: string }>(
    entity: EntityName,
    rec: T,
    extra: Record<string, unknown> = {},
  ) {
    const { id, createdAt = this.now, updatedAt = createdAt, ...fields } = rec;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one insert path for every table
    (this.tx.insert(TABLES[entity]) as any)
      .values({ id, version: 1, createdAt, updatedAt, ...fields, ...extra })
      .run();
    recordChange(this.tx, entity, id, 'create', 1, fields, this.now, this.sid);
  }

  location(v: z.output<typeof ExportLocation>, parentId: string | null) {
    this.put('location', { ...v, parentId });
  }

  work(v: z.output<typeof WorkFields> & { id: string; createdAt?: string; updatedAt?: string }) {
    this.put('work', v, workDerived(v));
  }

  edition(
    v: z.output<typeof EditionFields> & {
      id: string;
      workId: string;
      createdAt?: string;
      updatedAt?: string;
    },
  ) {
    this.put('edition', v);
  }

  copy(
    v: Omit<z.output<typeof ExportCopy>, 'createdAt' | 'updatedAt'> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ) {
    this.put('copy', v);
  }

  reading(
    v: z.output<typeof ReadingFields> & {
      id: string;
      copyId: string;
      createdAt?: string;
      updatedAt?: string;
    },
  ) {
    this.put('reading', v);
  }

  quote(v: z.output<typeof ExportQuote>) {
    this.put('quote', v);
  }

  wish(v: z.output<typeof ExportWish>) {
    this.put('wish', v);
  }

  /** "Home / Study / Shelf 2" → the matching location, creating the levels that are missing. */
  locationPath(path: string | null, onCreate: () => void): string | null {
    if (!path) return null;
    let parent: string | null = null;
    for (const name of path
      .split(CSV_PATH_SEPARATOR.trim())
      .map((s) => s.trim())
      .filter(Boolean)) {
      const siblings = this.tx
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(
          and(
            parent ? eq(locations.parentId, parent) : isNull(locations.parentId),
            isNull(locations.deletedAt),
          ),
        )
        .all();
      const found = siblings.find((l) => fold(l.name) === fold(name));
      if (found) parent = found.id;
      else {
        const id = uuidv7();
        this.put('location', { id, parentId: parent, name: name.slice(0, 80), kind: 'other', sortOrder: 0 });
        onCreate();
        parent = id;
      }
    }
    return parent;
  }
}
