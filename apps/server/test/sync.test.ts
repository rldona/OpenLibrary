import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@openlibrary/contracts';
import { bumpEpoch } from '../src/db/client.js';
import { makeApp, PASSWORD, webClient } from './helpers.js';

type App = Awaited<ReturnType<typeof makeApp>>['app'];

/** Client authenticated like the Android app (device Bearer token, no browser headers). */
async function deviceClient(app: App) {
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/devices',
    payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
  });
  const { token } = reg.json() as { token: string };
  return async (url: string, headers: Record<string, string> = {}) => {
    const r = await app.inject({
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}`, ...headers },
    });
    return { status: r.statusCode, body: r.json() as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

async function setup() {
  const ctx = await makeApp();
  const web = await webClient(ctx.app);
  const device = await deviceClient(ctx.app);
  const home = uuidv7();
  expect(
    (await web.post('/locations', { id: home, parentId: null, name: 'Casa', kind: 'home' })).status,
  ).toBe(201);
  const book = await web.post('/books', {
    work: { title: 'Fortunata y Jacinta', authors: ['Benito Pérez Galdós'] },
    edition: { publisher: 'Cátedra', language: 'es' },
    copy: { locationId: home, notes: 'Tomo I' },
  });
  expect(book.status).toBe(201);
  const workId: string = book.body.work.id;
  const edition = book.body.editions[0];
  return { ...ctx, web, device, home, workId, editionId: edition.id as string, copyId: edition.copies[0].id };
}

const pull = (since: number, epoch: string, limit?: number) =>
  `/sync/pull?since=${since}&epoch=${epoch}${limit ? `&limit=${limit}` : ''}`;

describe('sync snapshot', () => {
  it('returns every live entity, without server-only columns, and a cursor', async () => {
    const { device, workId, editionId, copyId, home } = await setup();
    const s = await device('/sync/snapshot');
    expect(s.status).toBe(200);
    expect(s.body.works).toEqual([
      expect.objectContaining({ id: workId, title: 'Fortunata y Jacinta', version: 1 }),
    ]);
    expect(s.body.works[0]).not.toHaveProperty('sortTitle');
    expect(s.body.works[0]).not.toHaveProperty('deletedAt');
    expect(s.body.editions).toEqual([
      expect.objectContaining({ id: editionId, workId, publisher: 'Cátedra' }),
    ]);
    expect(s.body.copies).toEqual([
      expect.objectContaining({ id: copyId, editionId, code: 'EJ-0001', locationId: home, notes: 'Tomo I' }),
    ]);
    expect(s.body.copies[0]).not.toHaveProperty('locationPath');
    expect(s.body.locations).toEqual([expect.objectContaining({ id: home, name: 'Casa', parentId: null })]);
    expect(s.body.cursor).toBeGreaterThan(0);
    expect(s.body.epoch).toMatch(/[0-9a-f-]{36}/);

    // Right after the snapshot there is nothing new.
    const p = await device(pull(s.body.cursor, s.body.epoch));
    expect(p.body).toMatchObject({ works: [], editions: [], copies: [], locations: [], deleted: [] });
    expect(p.body).toMatchObject({ cursor: s.body.cursor, hasMore: false });
  });

  it('skips deleted entities', async () => {
    const { device, web, editionId } = await setup();
    expect((await web.del(`/editions/${editionId}`)).status).toBe(200);
    const s = await device('/sync/snapshot');
    expect(s.body.editions).toEqual([]);
    expect(s.body.copies).toEqual([]);
  });

  it('requires a session or device token', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ url: '/api/v1/sync/snapshot' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/sync/pull?since=0&epoch=x' })).statusCode).toBe(401);
  });
});

describe('sync pull', () => {
  it('F2 acceptance: a change made on the web appears on the device after syncing', async () => {
    const { device, web, workId } = await setup();
    const s = await device('/sync/snapshot');
    expect(
      (await web.patch(`/works/${workId}`, { baseVersion: 1, fields: { subtitle: 'Dos historias' } })).status,
    ).toBe(200);
    expect(
      (await web.patch(`/works/${workId}`, { baseVersion: 2, fields: { series: 'Novelas' } })).status,
    ).toBe(200);

    const p = await device(pull(s.body.cursor, s.body.epoch));
    expect(p.status).toBe(200);
    // One record with the current state, not one per change.
    expect(p.body.works).toEqual([
      expect.objectContaining({ id: workId, version: 3, subtitle: 'Dos historias', series: 'Novelas' }),
    ]);
    expect(p.body.cursor).toBeGreaterThan(s.body.cursor);
    expect(p.body.hasMore).toBe(false);

    const again = await device(pull(p.body.cursor, p.body.epoch));
    expect(again.body.works).toEqual([]);
  });

  it('reports deletions as tombstones', async () => {
    const { device, web, editionId, copyId } = await setup();
    const s = await device('/sync/snapshot');
    expect((await web.del(`/editions/${editionId}`)).status).toBe(200);
    const p = await device(pull(s.body.cursor, s.body.epoch));
    expect(p.body.editions).toEqual([]);
    expect(p.body.deleted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity: 'edition', id: editionId, version: 2 }),
        expect.objectContaining({ entity: 'copy', id: copyId, version: 2 }),
      ]),
    );
  });

  it('pages through the log without losing or repeating entities', async () => {
    const { device, web, home } = await setup();
    const s = await device('/sync/snapshot');
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const id = uuidv7();
      ids.push(id);
      expect((await web.post('/locations', { id, parentId: home, name: `Balda ${i + 1}` })).status).toBe(201);
    }
    const seen: string[] = [];
    let cursor = s.body.cursor;
    let pages = 0;
    for (;;) {
      const p = await device(pull(cursor, s.body.epoch, 3));
      seen.push(...p.body.locations.map((l: { id: string }) => l.id));
      cursor = p.body.cursor;
      pages++;
      if (!p.body.hasMore) break;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(ids);
  });

  it('an entity changed again while paging comes back in a later page', async () => {
    const { device, web, home } = await setup();
    const s = await device('/sync/snapshot');
    const a = uuidv7();
    const b = uuidv7();
    await web.post('/locations', { id: a, parentId: home, name: 'A' });
    await web.post('/locations', { id: b, parentId: home, name: 'B' });

    const first = await device(pull(s.body.cursor, s.body.epoch, 1));
    expect(first.body.locations.map((l: { name: string }) => l.name)).toEqual(['A']);
    expect(first.body.hasMore).toBe(true);
    expect((await web.patch(`/locations/${a}`, { baseVersion: 1, fields: { name: 'A2' } })).status).toBe(200);

    const rest = await device(pull(first.body.cursor, s.body.epoch));
    expect(rest.body.locations.map((l: { name: string }) => l.name)).toEqual(['B', 'A2']);
    expect(rest.body.hasMore).toBe(false);
  });

  it('asks for a full resync after a restore (epoch changed), in the client language', async () => {
    const { device, db } = await setup();
    const s = await device('/sync/snapshot');
    bumpEpoch(db);
    const p = await device(pull(s.body.cursor, s.body.epoch), { 'accept-language': 'es' });
    expect(p.status).toBe(409);
    expect(p.body.code).toBe('epoch-mismatch');
    expect(p.body.detail).toContain('sincronización completa');
  });

  it('asks for a full resync when the cursor is ahead of the server', async () => {
    const { device } = await setup();
    const s = await device('/sync/snapshot');
    const p = await device(pull(s.body.cursor + 100, s.body.epoch));
    expect(p.status).toBe(409);
    expect(p.body.code).toBe('cursor-ahead');
  });

  it('validates the query', async () => {
    const { device } = await setup();
    expect((await device('/sync/pull?since=-1&epoch=x')).status).toBe(400);
    expect((await device('/sync/pull?since=0')).status).toBe(400);
    expect((await device('/sync/pull?since=0&epoch=x&limit=5000')).status).toBe(400);
  });
});

describe('sync transport', () => {
  it('compresses large responses when the client accepts it', async () => {
    const { app, web, home } = await setup();
    for (let i = 0; i < 30; i++) await web.post('/locations', { parentId: home, name: `Balda ${i + 1}` });
    const r = await app.inject({
      url: '/api/v1/sync/snapshot',
      headers: { 'accept-encoding': 'gzip' },
      cookies: { ol_session: web.token },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-encoding']).toBe('gzip');
  });
});
