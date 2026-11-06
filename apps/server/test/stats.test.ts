/**
 * F4 criterion: statistics match reference SQL queries. The service computes in memory; these queries are
 * written independently, straight from the definitions in packages/contracts/src/stats.ts.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@openlibrary/contracts';
import { makeApp, PASSWORD, webClient } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('../../../packages/contracts/fixtures/', import.meta.url));

async function library() {
  const ctx = await makeApp();
  const c = await webClient(ctx.app);
  const shelf = uuidv7();
  await c.post('/locations', { id: shelf, parentId: null, name: 'Balda', kind: 'shelf' });
  const add = async (
    title: string,
    authors: string[],
    extra: {
      language?: string;
      pages?: number;
      subjects?: string[];
      price?: number;
      currency?: string;
      acquiredOn?: string;
      locationId?: string | null;
      provisional?: boolean;
    } = {},
  ) => {
    const r = await c.post('/books', {
      work: { title, authors, subjects: extra.subjects ?? [] },
      edition: {
        language: extra.language,
        pages: extra.pages,
        metadataStatus: extra.provisional ? 'provisional' : 'complete',
      },
      copy: {
        locationId: extra.locationId ?? null,
        priceCents: extra.price,
        priceCurrency: extra.currency,
        acquiredOn: extra.acquiredOn,
      },
    });
    expect(r.status).toBe(201);
    return {
      workId: r.body.work.id as string,
      editionId: r.body.editions[0].id as string,
      copyId: r.body.editions[0].copies[0].id as string,
    };
  };

  const niebla = await add('Niebla', ['Unamuno'], {
    language: 'es',
    pages: 200,
    subjects: ['Novela'],
    price: 1000,
    acquiredOn: '2023-02-01',
    locationId: shelf,
  });
  const abel = await add('Abel Sánchez', ['Unamuno'], {
    language: 'es',
    pages: 150,
    subjects: ['Novela'],
    price: 850,
    acquiredOn: '2024-05-01',
  });
  const dune = await add('Dune', ['Frank Herbert'], {
    language: 'en',
    pages: 600,
    subjects: ['Ciencia ficción', 'Novela'],
    price: 1299,
    currency: 'USD',
    acquiredOn: '2024-06-01',
  });
  const draft = await add('Borrador', [], { provisional: true });
  const gone = await add('Regalado', ['Anónimo'], { language: 'fr', acquiredOn: '2020-01-01' });
  // Second copy of Niebla (another price), a retired copy and a deleted edition.
  await c.post('/copies', { editionId: niebla.editionId, priceCents: 500, acquiredOn: '2024-09-09' });
  await c.patch(`/copies/${gone.copyId}`, {
    baseVersion: 1,
    fields: { status: 'retired', retiredReason: 'gifted' },
  });
  await c.del(`/editions/${draft.editionId}`);

  // Readings: Niebla read twice (2023, 2025), Abel abandoned, Dune being read, a reading of the retired copy.
  await c.post('/reading-sessions', {
    copyId: niebla.copyId,
    status: 'read',
    finishedOn: '2023-03-01',
    rating: 4,
  });
  await c.post('/reading-sessions', {
    copyId: niebla.copyId,
    status: 'read',
    finishedOn: '2025-01-10',
    rating: 4.5,
  });
  await c.post('/reading-sessions', { copyId: abel.copyId, status: 'abandoned' });
  await c.post('/reading-sessions', { copyId: dune.copyId, status: 'reading' });
  await c.post('/reading-sessions', { copyId: gone.copyId, status: 'read', finishedOn: '2025-02-02' });

  await c.post('/wishlist', { title: 'San Manuel Bueno, mártir' });
  const unwanted = (await c.post('/wishlist', { title: 'Niebla' })).body;
  await c.del(`/wishlist/${unwanted.id}`);
  return { ...ctx, c };
}

describe('statistics', () => {
  it('F4 acceptance: every figure matches a reference SQL query', async () => {
    const { db, c } = await library();
    const sql = db.$client;
    const one = (q: string) => Object.values(sql.prepare(q).get() as object)[0];
    const all = <T>(q: string) => sql.prepare(q).all() as T[];
    const activeCopies = "SELECT * FROM copies WHERE deleted_at IS NULL AND status = 'active'";
    const editionsIn = `SELECT * FROM editions e WHERE e.deleted_at IS NULL AND EXISTS (SELECT 1 FROM (${activeCopies}) c WHERE c.edition_id = e.id)`;
    const worksIn = `SELECT * FROM works w WHERE w.deleted_at IS NULL AND EXISTS (SELECT 1 FROM (${editionsIn}) e WHERE e.work_id = w.id)`;
    const sessions = 'SELECT * FROM reading_sessions WHERE deleted_at IS NULL';
    const sessionWork = `SELECT s.*, e.work_id, e.pages FROM (${sessions}) s JOIN copies c ON c.id = s.copy_id JOIN editions e ON e.id = c.edition_id`;

    const stats = (await c.get('/stats')).body;

    expect(stats.collection).toEqual({
      works: one(`SELECT count(*) FROM (${worksIn})`),
      editions: one(`SELECT count(*) FROM (${editionsIn})`),
      copies: one(`SELECT count(*) FROM (${activeCopies})`),
      retiredCopies: one("SELECT count(*) FROM copies WHERE deleted_at IS NULL AND status = 'retired'"),
      copiesWithoutLocation: one(`SELECT count(*) FROM (${activeCopies}) WHERE location_id IS NULL`),
      provisionalEditions: one(`SELECT count(*) FROM (${editionsIn}) WHERE metadata_status = 'provisional'`),
      locations: one('SELECT count(*) FROM locations WHERE deleted_at IS NULL'),
      value: all(
        `SELECT price_currency AS currency, sum(price_cents) AS cents FROM (${activeCopies}) WHERE price_cents IS NOT NULL GROUP BY price_currency ORDER BY price_currency`,
      ),
    });

    const workStatus = `SELECT w.id, CASE
        WHEN EXISTS (SELECT 1 FROM (${sessionWork}) s WHERE s.work_id = w.id AND s.status = 'reading') THEN 'reading'
        WHEN EXISTS (SELECT 1 FROM (${sessionWork}) s WHERE s.work_id = w.id AND s.status = 'read') THEN 'read'
        ELSE 'pending' END AS st FROM (${worksIn}) w`;
    expect(stats.reading).toEqual({
      read: one(`SELECT count(*) FROM (${workStatus}) WHERE st = 'read'`),
      reading: one(`SELECT count(*) FROM (${workStatus}) WHERE st = 'reading'`),
      pending: one(`SELECT count(*) FROM (${workStatus}) WHERE st = 'pending'`),
      finishedSessions: one(`SELECT count(*) FROM (${sessions}) WHERE status = 'read'`),
      abandonedSessions: one(`SELECT count(*) FROM (${sessions}) WHERE status = 'abandoned'`),
      averageRating: one(
        `SELECT round(avg(rating), 2) FROM (${sessions}) WHERE status = 'read' AND rating IS NOT NULL`,
      ),
      byYear:
        all(`SELECT CAST(substr(finished_on, 1, 4) AS INTEGER) AS year, count(DISTINCT work_id) AS works, sum(coalesce(pages, 0)) AS pages
        FROM (${sessionWork}) WHERE status = 'read' AND finished_on IS NOT NULL GROUP BY year ORDER BY year DESC`),
    });

    expect(stats.acquiredByYear).toEqual(
      all(`SELECT CAST(substr(acquired_on, 1, 4) AS INTEGER) AS year, count(*) AS copies FROM copies
        WHERE deleted_at IS NULL AND acquired_on IS NOT NULL GROUP BY year ORDER BY year DESC`),
    );
    expect(stats.authors).toEqual(
      all(
        `SELECT a.value AS key, count(DISTINCT w.id) AS count FROM (${worksIn}) w, json_each(w.authors) a GROUP BY a.value ORDER BY count DESC, key LIMIT 10`,
      ),
    );
    expect(stats.subjects).toEqual(
      all(
        `SELECT s.value AS key, count(DISTINCT w.id) AS count FROM (${worksIn}) w, json_each(w.subjects) s GROUP BY s.value ORDER BY count DESC, key LIMIT 10`,
      ),
    );
    expect(stats.languages).toEqual(
      all(
        `SELECT coalesce(language, '') AS key, count(*) AS count FROM (${editionsIn}) GROUP BY key ORDER BY count DESC, key`,
      ),
    );
    expect(stats.wishlistOpen).toBe(
      one("SELECT count(*) FROM wishlist_items WHERE deleted_at IS NULL AND status = 'open'"),
    );
  });

  it('the figures say what the data means (works vs copies)', async () => {
    const { c } = await library();
    const s = (await c.get('/stats')).body;
    // Niebla, Abel and Dune: the retired "Regalado" and the deleted "Borrador" are not in the collection.
    expect(s.collection).toMatchObject({
      works: 3,
      editions: 3,
      copies: 4,
      retiredCopies: 1,
      copiesWithoutLocation: 3,
    });
    expect(s.collection.value).toEqual([
      { currency: 'EUR', cents: 2350 },
      { currency: 'USD', cents: 1299 },
    ]);
    // Re-reading Niebla counts the work once as read; Dune is being read; Abel was abandoned (pending).
    expect(s.reading).toMatchObject({
      read: 1,
      reading: 1,
      pending: 1,
      finishedSessions: 3,
      abandonedSessions: 1,
      averageRating: 4.25,
    });
    expect(s.reading.byYear).toEqual([
      { year: 2025, works: 2, pages: 200 },
      { year: 2023, works: 1, pages: 200 },
    ]);
    expect(s.authors[0]).toEqual({ key: 'Unamuno', count: 2 });
    expect(s.wishlistOpen).toBe(1);
  });

  it('exports this library as a snapshot plus its statistics, for the Android parity test', async () => {
    const { app, c } = await library();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices',
      payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
    });
    const auth = { authorization: `Bearer ${reg.json().token}` };
    const snapshot = (await app.inject({ url: '/api/v1/sync/snapshot', headers: auth })).json();
    const stats = (await c.get('/stats')).body;
    if (process.env.UPDATE_FIXTURES) {
      fs.writeFileSync(`${FIXTURES}stats-library-snapshot.json`, JSON.stringify(snapshot, null, 2) + '\n');
      fs.writeFileSync(`${FIXTURES}stats-library.json`, JSON.stringify(stats, null, 2) + '\n');
    }
    // The committed pair must still be what this library produces (ids aside, the figures are stable).
    expect(JSON.parse(fs.readFileSync(`${FIXTURES}stats-library.json`, 'utf8'))).toEqual(stats);
  });

  it('requires a session', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ url: '/api/v1/stats' })).statusCode).toBe(401);
  });
});
