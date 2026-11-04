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
  const call = async (url: string, headers: Record<string, string> = {}, payload?: object) => {
    const r = await app.inject({
      method: payload ? 'POST' : 'GET',
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}`, ...headers },
      ...(payload ? { payload } : {}),
    });
    return { status: r.statusCode, body: r.json() as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return Object.assign(call, {
    push: (epoch: string, ops: object[], headers: Record<string, string> = {}) =>
      call('/sync/push', headers, { epoch, ops }),
  });
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

describe('sync push', () => {
  const epochOf = async (device: Awaited<ReturnType<typeof setup>>['device']) =>
    (await device('/sync/snapshot')).body.epoch as string;

  it('F3 acceptance: a book added offline is created once, however many times the batch is sent', async () => {
    const { device, web, home } = await setup();
    const epoch = await epochOf(device);
    const ids = { work: uuidv7(), edition: uuidv7(), copy: uuidv7() };
    const batch = [
      {
        opId: uuidv7(),
        type: 'book.create',
        book: {
          work: { id: ids.work, title: 'Misericordia', authors: ['Benito Pérez Galdós'] },
          edition: { id: ids.edition, isbn13: '9788437604800', metadataStatus: 'provisional' },
          copy: { id: ids.copy, locationId: home },
        },
      },
    ];
    for (let i = 0; i < 3; i++) {
      const r = await device.push(epoch, batch);
      expect(r.status).toBe(200);
      expect(r.body.results[0].status).toBe(i === 0 ? 'applied' : 'duplicate');
    }
    const work = await web.get(`/works/${ids.work}`);
    expect(work.body.editions).toHaveLength(1);
    expect(work.body.editions[0]).toMatchObject({ id: ids.edition, metadataStatus: 'provisional' });
    expect(work.body.editions[0].copies).toEqual([
      expect.objectContaining({ id: ids.copy, code: 'EJ-0002' }),
    ]);
  });

  it('a device editing the same field twice offline never conflicts with itself', async () => {
    const { device, copyId } = await setup();
    const epoch = await epochOf(device);
    const edit = (notes: string) => ({
      opId: uuidv7(),
      type: 'copy.update',
      id: copyId,
      patch: { baseVersion: 1, fields: { notes } },
    });
    const r = await device.push(epoch, [edit('Primero'), edit('Después')]);
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(['applied', 'applied']);
    const copy = (await device('/sync/snapshot')).body.copies.find((c: { id: string }) => c.id === copyId);
    expect(copy.notes).toBe('Después');
  });

  it('applies ops in order: a location created offline can hold a copy created in the same batch', async () => {
    const { device, web, home, editionId } = await setup();
    const epoch = await epochOf(device);
    const shelf = uuidv7();
    const copy = uuidv7();
    const r = await device.push(epoch, [
      { opId: uuidv7(), type: 'location.create', location: { id: shelf, parentId: home, name: 'Mesilla' } },
      {
        opId: uuidv7(),
        type: 'copy.create',
        copy: { id: copy, editionId, locationId: shelf, condition: 'new' },
      },
    ]);
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(['applied', 'applied']);
    const tree = await web.get('/locations');
    expect(tree.body.items.find((l: { id: string }) => l.id === shelf)).toMatchObject({ copyCount: 1 });
  });

  it('merges different fields edited on web and phone without losing either', async () => {
    const { device, web, copyId, home } = await setup();
    const epoch = await epochOf(device);
    expect(
      (await web.patch(`/copies/${copyId}`, { baseVersion: 1, fields: { notes: 'Dedicado' } })).status,
    ).toBe(200);
    const room = uuidv7();
    await web.post('/locations', { id: room, parentId: home, name: 'Despacho' });
    const r = await device.push(epoch, [
      {
        opId: uuidv7(),
        type: 'copy.update',
        id: copyId,
        patch: { baseVersion: 1, fields: { locationId: room } },
      },
    ]);
    expect(r.body.results[0].status).toBe('applied');
    const copy = (await device('/sync/snapshot')).body.copies.find((c: { id: string }) => c.id === copyId);
    expect(copy).toMatchObject({ notes: 'Dedicado', locationId: room, version: 3 });
  });

  it('F3 acceptance: the same field edited on web and phone is a visible conflict, nothing overwritten', async () => {
    const { device, web, copyId } = await setup();
    const epoch = await epochOf(device);
    await web.patch(`/copies/${copyId}`, { baseVersion: 1, fields: { notes: 'Prestado a Ana' } });
    const opId = uuidv7();
    const op = {
      opId,
      type: 'copy.update',
      id: copyId,
      patch: { baseVersion: 1, fields: { notes: 'En la mesilla' } },
    };
    const r = await device.push(epoch, [op], { 'accept-language': 'es' });
    expect(r.body.results[0]).toMatchObject({
      opId,
      status: 'conflict',
      code: 'conflict',
      currentVersion: 2,
      conflicts: [{ field: 'notes', current: 'Prestado a Ana', yours: 'En la mesilla' }],
    });
    expect(r.body.results[0].message).toContain('Otro dispositivo');
    const copy = (await device('/sync/snapshot')).body.copies.find((c: { id: string }) => c.id === copyId);
    expect(copy.notes).toBe('Prestado a Ana');

    // "Keep mine" is just a new op based on the version the conflict reported.
    const resolve = await device.push(epoch, [
      {
        opId: uuidv7(),
        type: 'copy.update',
        id: copyId,
        patch: { baseVersion: 2, fields: { notes: 'En la mesilla' } },
      },
    ]);
    expect(resolve.body.results[0].status).toBe('applied');
  });

  it('rejects invalid ops one by one without failing the batch', async () => {
    const { device } = await setup();
    const epoch = await epochOf(device);
    const r = await device.push(
      epoch,
      [
        { opId: uuidv7(), type: 'book.create', book: { work: { title: '' }, edition: {}, copy: {} } },
        { opId: uuidv7(), type: 'copy.create', copy: { editionId: uuidv7() } },
        { opId: uuidv7(), type: 'teleport' },
        { opId: uuidv7(), type: 'location.create', location: { parentId: null, name: 'Trastero' } },
      ],
      { 'accept-language': 'es' },
    );
    expect(r.status).toBe(200);
    expect(
      r.body.results.map((x: { status: string; code: string }) => `${x.status}:${x.code ?? ''}`),
    ).toEqual(['rejected:validation', 'rejected:bad-request', 'rejected:validation', 'applied:']);
    expect(r.body.results[1].message).toBe('La edición indicada no existe.');
  });

  it('a rejected op is not remembered: once its cause is fixed the same op can be applied', async () => {
    const { device, web, home } = await setup();
    const epoch = await epochOf(device);
    const parent = uuidv7();
    const op = { opId: uuidv7(), type: 'location.create', location: { parentId: parent, name: 'Balda' } };
    expect((await device.push(epoch, [op])).body.results[0].status).toBe('rejected');
    await web.post('/locations', { id: parent, parentId: home, name: 'Estantería' });
    expect((await device.push(epoch, [op])).body.results[0].status).toBe('applied');
  });

  it('refuses the whole batch after a restore, and validates its shape', async () => {
    const { device, db } = await setup();
    const epoch = await epochOf(device);
    const op = { opId: uuidv7(), type: 'location.create', location: { parentId: null, name: 'X' } };
    expect((await device.push(epoch, [])).status).toBe(400);
    expect(
      (
        await device.push(
          epoch,
          Array.from({ length: 101 }, () => ({ ...op, opId: uuidv7() })),
        )
      ).status,
    ).toBe(400);
    expect((await device.push(epoch, [{ type: 'location.create' }])).status).toBe(400);
    bumpEpoch(db);
    const r = await device.push(epoch, [op]);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('epoch-mismatch');
  });
});
