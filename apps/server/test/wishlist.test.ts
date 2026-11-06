import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { uuidv7, withCheckDigit } from '@openlibrary/contracts';
import { makeApp, ORIGIN, PASSWORD, webClient } from './helpers.js';

const ISBN = withCheckDigit('978843760494');

async function setup() {
  const ctx = await makeApp();
  return { ...ctx, c: await webClient(ctx.app) };
}

describe('wishlist', () => {
  it('a wish never counts as collection (BR14)', async () => {
    const { c } = await setup();
    const w = await c.post('/wishlist', {
      title: 'San Manuel Bueno, mártir',
      authors: ['Miguel de Unamuno'],
    });
    expect(w.status).toBe(201);
    expect(w.body).toMatchObject({ status: 'open', priority: 'normal', isbn13: null, version: 1 });
    expect((await c.get('/library')).body.total).toBe(0);
  });

  it('F4 acceptance: "I bought it" for an edition you own adds a copy without duplicating the work', async () => {
    const { c } = await setup();
    const book = await c.post('/books', { work: { title: 'Niebla' }, edition: { isbn13: ISBN }, copy: {} });
    const editionId = book.body.editions[0].id;
    const wish = (await c.post('/wishlist', { title: 'Niebla (otro ejemplar)', isbn13: ISBN })).body;

    // The client adds the copy to the edition it already has, then marks the wish as acquired.
    const added = await c.post('/copies', { editionId, condition: 'new' });
    const copyId = added.body.created.copyId;
    const done = await c.patch(`/wishlist/${wish.id}`, {
      baseVersion: wish.version,
      fields: { status: 'acquired', acquiredCopyId: copyId },
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'acquired', acquiredCopyId: copyId, version: 2 });

    const library = (await c.get('/library')).body;
    expect(library.total).toBe(1); // still one work and one edition…
    expect(library.items[0].copies).toHaveLength(2); // …with two copies
  });

  it('"I bought it" for a new book creates it and keeps the wish as history', async () => {
    const { c } = await setup();
    const wish = (await c.post('/wishlist', { title: 'Abel Sánchez', authors: ['Miguel de Unamuno'] })).body;
    const book = await c.post('/books', {
      work: { title: 'Abel Sánchez', authors: ['Miguel de Unamuno'] },
      edition: {},
      copy: {},
    });
    await c.patch(`/wishlist/${wish.id}`, {
      baseVersion: 1,
      fields: { status: 'acquired', acquiredCopyId: book.body.created.copyId },
    });
    const list = (await c.get('/wishlist')).body.items;
    expect(list).toEqual([expect.objectContaining({ id: wish.id, status: 'acquired' })]);
  });

  it('lists open wishes first, by priority, then the bought ones', async () => {
    const { c } = await setup();
    await c.post('/wishlist', { title: 'Baja', priority: 'low' });
    const book = await c.post('/books', { work: { title: 'Comprado' }, edition: {}, copy: {} });
    const bought = (await c.post('/wishlist', { title: 'Comprado', priority: 'high' })).body;
    await c.patch(`/wishlist/${bought.id}`, {
      baseVersion: 1,
      fields: { status: 'acquired', acquiredCopyId: book.body.created.copyId },
    });
    await c.post('/wishlist', { title: 'Alta', priority: 'high' });
    await c.post('/wishlist', { title: 'Normal' });
    const titles = (await c.get('/wishlist')).body.items.map((w: { title: string }) => w.title);
    expect(titles).toEqual(['Alta', 'Normal', 'Baja', 'Comprado']);
  });

  it('deletes a wish for good; deleting it again is a no-op', async () => {
    const { c } = await setup();
    const keep = (await c.post('/wishlist', { title: 'Niebla' })).body;
    const gone = (await c.post('/wishlist', { title: 'Abel Sánchez' })).body;
    const del = await c.del(`/wishlist/${gone.id}`);
    expect(del.status).toBe(204);
    expect(del.raw.body).toBe('');
    expect((await c.get('/wishlist')).body.items).toEqual([expect.objectContaining({ id: keep.id })]);
    expect((await c.del(`/wishlist/${gone.id}`)).status).toBe(204);
    expect((await c.del(`/wishlist/${uuidv7()}`)).status).toBe(404);
    expect((await c.patch(`/wishlist/${gone.id}`, { baseVersion: 2, fields: { notes: 'x' } })).status).toBe(
      404,
    );
  });

  it('a bought wish is kept as a record and cannot be deleted', async () => {
    const { c } = await setup();
    const book = await c.post('/books', { work: { title: 'Niebla' }, edition: {}, copy: {} });
    const wish = (await c.post('/wishlist', { title: 'Niebla' })).body;
    await c.patch(`/wishlist/${wish.id}`, {
      baseVersion: 1,
      fields: { status: 'acquired', acquiredCopyId: book.body.created.copyId },
    });
    const del = await c.del(`/wishlist/${wish.id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('wish-acquired');
    expect((await c.get('/wishlist')).body.items).toEqual([expect.objectContaining({ id: wish.id })]);
  });

  it('an older client that discards a wish deletes it', async () => {
    const { app, c } = await setup();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices',
      payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
    });
    const auth = { authorization: `Bearer ${reg.json().token}` };
    const snap = (await app.inject({ url: '/api/v1/sync/snapshot', headers: auth })).json();
    const wish = (await c.post('/wishlist', { title: 'Descartado' })).body;
    const old = await c.patch(`/wishlist/${wish.id}`, { baseVersion: 1, fields: { status: 'discarded' } });
    expect(old.status).toBe(200);
    expect((await c.get('/wishlist')).body.items).toEqual([]);
    const page = (
      await app.inject({ url: `/api/v1/sync/pull?since=${snap.cursor}&epoch=${snap.epoch}`, headers: auth })
    ).json();
    expect(page.wishes).toEqual([]);
    expect(page.deleted).toEqual([expect.objectContaining({ entity: 'wish', id: wish.id })]);
  });

  it('"discarded" only comes alone in an update and never in a new wish', async () => {
    const { app, c } = await setup();
    const wish = (await c.post('/wishlist', { title: 'Niebla' })).body;
    const mixed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/wishlist/${wish.id}`,
      headers: { origin: ORIGIN, 'accept-language': 'es' },
      cookies: { ol_session: c.token },
      payload: { baseVersion: 1, fields: { status: 'discarded', notes: 'ya no' } },
    });
    expect(mixed.statusCode).toBe(400);
    expect(mixed.json().code).toBe('validation');
    expect(mixed.json().detail).toContain('Descartar un deseo lo elimina');
    expect((await c.get('/wishlist')).body.items).toEqual([
      expect.objectContaining({ id: wish.id, version: 1, notes: '' }),
    ]);

    const created = await c.post('/wishlist', { title: 'Abel Sánchez', status: 'discarded' });
    expect(created.status).toBe(400);
    expect(created.body.code).toBe('validation');
    expect(created.body.detail).toContain('A new wish cannot be discarded.');

    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices',
      payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
    });
    const auth = { authorization: `Bearer ${reg.json().token}` };
    const { epoch } = (await app.inject({ url: '/api/v1/sync/snapshot', headers: auth })).json();
    const results = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: auth,
        payload: {
          epoch,
          ops: [
            { opId: uuidv7(), type: 'wish.create', wish: { id: uuidv7(), title: 'X', status: 'discarded' } },
            {
              opId: uuidv7(),
              type: 'wish.update',
              id: wish.id,
              patch: { baseVersion: 1, fields: { status: 'discarded', priority: 'high' } },
            },
          ],
        },
      })
    ).json().results;
    expect(results).toEqual([
      expect.objectContaining({ status: 'rejected', code: 'validation' }),
      expect.objectContaining({ status: 'rejected', code: 'validation' }),
    ]);
    expect((await c.get('/wishlist')).body.items.map((w: { id: string }) => w.id)).toEqual([wish.id]);
  });

  it('wish.delete syncs as a tombstone and is idempotent', async () => {
    const { app, c } = await setup();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices',
      payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
    });
    const auth = { authorization: `Bearer ${reg.json().token}` };
    const snap = (await app.inject({ url: '/api/v1/sync/snapshot', headers: auth })).json();
    const push = async (ops: unknown[]) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/sync/push',
          headers: auth,
          payload: { epoch: snap.epoch, ops },
        })
      ).json().results as { status: string; code?: string }[];

    const id = uuidv7();
    const del = { opId: uuidv7(), type: 'wish.delete', id };
    const [created, deleted] = await push([
      { opId: uuidv7(), type: 'wish.create', wish: { id, title: 'Del móvil' } },
      del,
    ]);
    expect(created!.status).toBe('applied');
    expect(deleted!.status).toBe('applied');
    expect((await c.get('/wishlist')).body.items).toEqual([]);
    const page = (
      await app.inject({ url: `/api/v1/sync/pull?since=${snap.cursor}&epoch=${snap.epoch}`, headers: auth })
    ).json();
    expect(page.deleted).toEqual([expect.objectContaining({ entity: 'wish', id })]);

    expect((await push([del]))[0]!.status).toBe('duplicate');
    // Another device deleted it too: nothing left to do.
    expect((await push([{ opId: uuidv7(), type: 'wish.delete', id }]))[0]!.status).toBe('applied');
    expect((await push([{ opId: uuidv7(), type: 'wish.delete', id: uuidv7() }]))[0]).toMatchObject({
      status: 'rejected',
      code: 'not-found',
    });

    const book = await c.post('/books', { work: { title: 'Niebla' }, edition: {}, copy: {} });
    const bought = (await c.post('/wishlist', { title: 'Niebla' })).body;
    await c.patch(`/wishlist/${bought.id}`, {
      baseVersion: 1,
      fields: { status: 'acquired', acquiredCopyId: book.body.created.copyId },
    });
    expect((await push([{ opId: uuidv7(), type: 'wish.delete', id: bought.id }]))[0]).toMatchObject({
      status: 'rejected',
      code: 'wish-acquired',
    });
  });

  it('validates title, ISBN and links', async () => {
    const { c } = await setup();
    expect((await c.post('/wishlist', { title: '' })).status).toBe(400);
    expect((await c.post('/wishlist', { title: 'X', isbn13: '9771234567003' })).status).toBe(400); // ISSN
    expect((await c.post('/wishlist', { title: 'X', acquiredCopyId: uuidv7() })).status).toBe(400);
    expect((await c.post('/wishlist', { title: 'X', workId: uuidv7() })).status).toBe(400);
    expect((await c.post('/wishlist', { title: 'X', isbn13: '84-376-0494-X' })).body.isbn13).toBe(ISBN);
  });

  it('wishes sync both ways', async () => {
    const { app, c } = await setup();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices',
      payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
    });
    const auth = { authorization: `Bearer ${reg.json().token}` };
    const snap = (await app.inject({ url: '/api/v1/sync/snapshot', headers: auth })).json();
    expect(snap.wishes).toEqual([]);

    await c.post('/wishlist', { title: 'Del web' });
    const page = (
      await app.inject({ url: `/api/v1/sync/pull?since=${snap.cursor}&epoch=${snap.epoch}`, headers: auth })
    ).json();
    expect(page.wishes).toEqual([expect.objectContaining({ title: 'Del web' })]);

    const op = {
      opId: uuidv7(),
      type: 'wish.create',
      wish: { id: uuidv7(), title: 'Del móvil', isbn13: ISBN },
    };
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: auth,
      payload: { epoch: snap.epoch, ops: [op] },
    });
    expect(r.json().results[0].status).toBe('applied');
    expect((await c.get('/wishlist')).body.items.map((w: { title: string }) => w.title)).toContain(
      'Del móvil',
    );
  });

  it('a wish keeps the cover found by its ISBN, which must exist on the server', async () => {
    const { app, c } = await setup();
    const jpeg = await sharp({ create: { width: 300, height: 450, channels: 3, background: '#264653' } })
      .jpeg()
      .toBuffer();
    const cover = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/assets',
        headers: { origin: ORIGIN, 'content-type': 'image/jpeg' },
        cookies: { ol_session: c.token },
        payload: jpeg,
      })
    ).json().id as string;
    const w = await c.post('/wishlist', { title: 'Antifrágil', isbn13: ISBN, coverAssetId: cover });
    expect(w.status).toBe(201);
    expect(w.body.coverAssetId).toBe(cover);
    expect((await c.post('/wishlist', { title: 'X', coverAssetId: 'ab'.repeat(32) })).status).toBe(400);
    const patched = await c.patch(`/wishlist/${w.body.id}`, {
      baseVersion: 1,
      fields: { coverAssetId: null },
    });
    expect(patched.body.coverAssetId).toBeNull();
  });
});
