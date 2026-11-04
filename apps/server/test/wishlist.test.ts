import { describe, expect, it } from 'vitest';
import { uuidv7, withCheckDigit } from '@openlibrary/contracts';
import { makeApp, PASSWORD, webClient } from './helpers.js';

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

  it('lists open wishes first, by priority, then the rest', async () => {
    const { c } = await setup();
    await c.post('/wishlist', { title: 'Baja', priority: 'low' });
    const gone = (await c.post('/wishlist', { title: 'Descartado', priority: 'high' })).body;
    await c.patch(`/wishlist/${gone.id}`, { baseVersion: 1, fields: { status: 'discarded' } });
    await c.post('/wishlist', { title: 'Alta', priority: 'high' });
    await c.post('/wishlist', { title: 'Normal' });
    const titles = (await c.get('/wishlist')).body.items.map((w: { title: string }) => w.title);
    expect(titles).toEqual(['Alta', 'Normal', 'Baja', 'Descartado']);
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
});
