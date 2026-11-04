/**
 * Statistics (F4, UC11), with the definitions in packages/contracts/src/stats.ts. Computed in memory from the
 * live rows: a few thousand books are milliseconds, and the code reads like the definitions (the tests
 * check it against hand-written SQL).
 */
import { isNull } from 'drizzle-orm';
import { STATS_TOP, workReadingStatus, type CountBy, type StatsDTO } from '@openlibrary/contracts';
import type { Db } from '../db/client.js';
import { copies, editions, locations, readingSessions, wishlistItems, works } from '../db/schema.js';

/** Plain code-point order (not locale aware), like SQLite's default collation and Kotlin's String order. */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const rank = (counts: Map<string, number>, top = STATS_TOP): CountBy[] =>
  [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || byCodePoint(a.key, b.key))
    .slice(0, top);

const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const yearOf = (iso: string | null) => (iso && /^\d{4}/.test(iso) ? Number(iso.slice(0, 4)) : null);

export class StatsService {
  constructor(private readonly db: Db) {}

  stats(): StatsDTO {
    const db = this.db;
    const allCopies = db.select().from(copies).where(isNull(copies.deletedAt)).all();
    const active = allCopies.filter((c) => c.status === 'active');
    const eds = new Map(
      db
        .select()
        .from(editions)
        .where(isNull(editions.deletedAt))
        .all()
        .map((e) => [e.id, e]),
    );
    const wks = new Map(
      db
        .select()
        .from(works)
        .where(isNull(works.deletedAt))
        .all()
        .map((w) => [w.id, w]),
    );
    const sessions = db.select().from(readingSessions).where(isNull(readingSessions.deletedAt)).all();
    const copyById = new Map(allCopies.map((c) => [c.id, c]));

    // Collection: editions and works with at least one active copy.
    const edsIn = new Set(active.map((c) => c.editionId).filter((id) => eds.has(id)));
    const worksIn = new Set([...edsIn].map((id) => eds.get(id)!.workId).filter((id) => wks.has(id)));
    const value = new Map<string, number>();
    for (const c of active) if (c.priceCents != null) bump(value, c.priceCurrency, c.priceCents);

    // Reading: derived status per work in the collection.
    const workOfCopy = (copyId: string) => {
      const c = copyById.get(copyId);
      return c ? eds.get(c.editionId)?.workId : undefined;
    };
    const byWork = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const w = workOfCopy(s.copyId);
      if (w) byWork.set(w, [...(byWork.get(w) ?? []), s]);
    }
    const status = { read: 0, reading: 0, pending: 0 };
    for (const w of worksIn) status[workReadingStatus(byWork.get(w) ?? [])]++;

    const finished = sessions.filter((s) => s.status === 'read');
    const rated = finished.filter((s) => s.rating != null);
    const years = new Map<number, { works: Set<string>; pages: number }>();
    for (const s of finished) {
      const y = yearOf(s.finishedOn);
      const c = copyById.get(s.copyId);
      const e = c && eds.get(c.editionId);
      if (y == null || !e) continue;
      const entry = years.get(y) ?? { works: new Set(), pages: 0 };
      entry.works.add(e.workId);
      entry.pages += e.pages ?? 0;
      years.set(y, entry);
    }

    const acquired = new Map<number, number>();
    for (const c of allCopies) {
      const y = yearOf(c.acquiredOn);
      if (y != null) acquired.set(y, (acquired.get(y) ?? 0) + 1);
    }

    const authors = new Map<string, number>();
    const subjects = new Map<string, number>();
    for (const id of worksIn) {
      const w = wks.get(id)!;
      for (const a of new Set(w.authors)) bump(authors, a);
      for (const s of new Set(w.subjects)) bump(subjects, s);
    }
    const languages = new Map<string, number>();
    for (const id of edsIn) bump(languages, eds.get(id)!.language ?? '');

    return {
      collection: {
        works: worksIn.size,
        editions: edsIn.size,
        copies: active.length,
        retiredCopies: allCopies.length - active.length,
        copiesWithoutLocation: active.filter((c) => !c.locationId).length,
        provisionalEditions: [...edsIn].filter((id) => eds.get(id)!.metadataStatus === 'provisional').length,
        locations: db.select().from(locations).where(isNull(locations.deletedAt)).all().length,
        value: [...value]
          .map(([currency, cents]) => ({ currency, cents }))
          .sort((a, b) => byCodePoint(a.currency, b.currency)),
      },
      reading: {
        ...status,
        finishedSessions: finished.length,
        abandonedSessions: sessions.filter((s) => s.status === 'abandoned').length,
        averageRating: rated.length
          ? Math.round((rated.reduce((n, s) => n + s.rating!, 0) / rated.length) * 100) / 100
          : null,
        byYear: [...years]
          .map(([year, e]) => ({ year, works: e.works.size, pages: e.pages }))
          .sort((a, b) => b.year - a.year),
      },
      acquiredByYear: [...acquired].map(([year, n]) => ({ year, copies: n })).sort((a, b) => b.year - a.year),
      authors: rank(authors),
      subjects: rank(subjects),
      languages: rank(languages, Infinity),
      wishlistOpen: db
        .select()
        .from(wishlistItems)
        .where(isNull(wishlistItems.deletedAt))
        .all()
        .filter((w) => w.status === 'open').length,
    };
  }
}
