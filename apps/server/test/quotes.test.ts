import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@openlibrary/contracts';
import { makeApp, PASSWORD, webClient } from './helpers.js';

async function setup() {
  const ctx = await makeApp();
  const c = await webClient(ctx.app);
  const book = await c.post('/books', { work: { title: 'Niebla' }, edition: {}, copy: {} });
  const other = await c.post('/books', { work: { title: 'Otra' }, edition: {}, copy: {} });
  return {
    ...ctx,
    c,
    workId: book.body.work.id as string,
    copyId: book.body.editions[0].copies[0].id as string,
    otherCopyId: other.body.editions[0].copies[0].id as string,
  };
}

describe('quotes', () => {
  it('adds, edits and deletes quotes, in page order', async () => {
    const { c, workId, copyId } = await setup();
    await c.post('/quotes', { workId, text: 'Sin página' });
    await c.post('/quotes', { workId, text: 'Página 40', page: 40 });
    const r = await c.post('/quotes', { workId, text: 'Página 12', page: 12, copyId, note: 'Augusto' });
    expect(r.status).toBe(201);
    expect(r.body.quotes.map((q: { text: string }) => q.text)).toEqual([
      'Página 12',
      'Página 40',
      'Sin página',
    ]);

    const q = r.body.quotes[0];
    const edited = await c.patch(`/quotes/${q.id}`, { baseVersion: 1, fields: { page: 13 } });
    expect(edited.body.quotes[0]).toMatchObject({ page: 13, note: 'Augusto', copyId, version: 2 });

    const left = await c.del(`/quotes/${q.id}`);
    expect(left.body.quotes).toHaveLength(2);
    expect((await c.del(`/quotes/${q.id}`)).status).toBe(404);
  });

  it('validates text, work and that the copy belongs to the work', async () => {
    const { c, workId, otherCopyId } = await setup();
    expect((await c.post('/quotes', { workId, text: '   ' })).status).toBe(400);
    expect((await c.post('/quotes', { workId: uuidv7(), text: 'x' })).status).toBe(400);
    expect((await c.post('/quotes', { workId, text: 'x', copyId: otherCopyId })).status).toBe(400);
    expect((await c.post('/quotes', { workId, text: 'x', page: 0 })).status).toBe(400);
  });

  it('quotes sync, including deletions from a device', async () => {
    const { app, c, workId } = await setup();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices',
      payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
    });
    const auth = { authorization: `Bearer ${reg.json().token}` };
    const snap = (await app.inject({ url: '/api/v1/sync/snapshot', headers: auth })).json();
    const id = uuidv7();
    const push = (ops: object[]) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: auth,
        payload: { epoch: snap.epoch, ops },
      });

    expect(
      (
        await push([
          { opId: uuidv7(), type: 'quote.create', quote: { id, workId, text: 'Desde el móvil', page: 7 } },
        ])
      ).json().results[0].status,
    ).toBe('applied');
    expect((await c.get(`/works/${workId}`)).body.quotes).toEqual([expect.objectContaining({ id, page: 7 })]);

    expect((await push([{ opId: uuidv7(), type: 'quote.delete', id }])).json().results[0].status).toBe(
      'applied',
    );
    expect((await c.get(`/works/${workId}`)).body.quotes).toEqual([]);
    const page = (
      await app.inject({ url: `/api/v1/sync/pull?since=${snap.cursor}&epoch=${snap.epoch}`, headers: auth })
    ).json();
    expect(page.deleted).toEqual([expect.objectContaining({ entity: 'quote', id })]);
  });
});
