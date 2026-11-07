import { describe, expect, it } from 'vitest';
import { makeApp, webClient } from './helpers.js';

type Client = Awaited<ReturnType<typeof webClient>>;

async function setup() {
  const ctx = await makeApp();
  const c = await webClient(ctx.app);
  const add = async (title: string, edition: Record<string, unknown> = {}) => {
    const r = await c.post('/books', { work: { title }, edition, copy: {} });
    expect(r.status).toBe(201);
    return {
      workId: r.body.work.id as string,
      editionId: r.body.editions[0].id as string,
      copyId: r.body.editions[0].copies[0].id as string,
    };
  };
  return { ...ctx, c, add };
}

const titles = async (c: Client, qs: string) =>
  (await c.get(`/library?${qs}`)).body.items.map((i: { title: string }) => i.title).sort();

async function read(c: Client, copyId: string, status: 'reading' | 'read' | 'abandoned') {
  const start = await c.post('/reading-sessions', { copyId, status: status === 'read' ? 'read' : 'reading' });
  expect(start.status).toBe(201);
  if (status === 'abandoned') {
    const s = start.body.readings.at(-1);
    const r = await c.patch(`/reading-sessions/${s.id}`, {
      baseVersion: s.version,
      fields: { status: 'abandoned' },
    });
    expect(r.status).toBe(200);
  }
}

describe('library filters', () => {
  it('filters by the work’s reading status, with the same rule as workReadingStatus (BR13)', async () => {
    const { c, add } = await setup();
    await add('Never opened');
    const reading = await add('Reading now');
    await read(c, reading.copyId, 'reading');
    const done = await add('Read once');
    await read(c, done.copyId, 'read');
    const dropped = await add('Abandoned');
    await read(c, dropped.copyId, 'abandoned');
    // Read before, now reading again: "reading" wins.
    const again = await add('Read again');
    await read(c, again.copyId, 'read');
    await read(c, again.copyId, 'reading');
    // Abandoned after a finished reading: still read.
    const mixed = await add('Read, then abandoned');
    await read(c, mixed.copyId, 'read');
    await read(c, mixed.copyId, 'abandoned');

    expect(await titles(c, 'reading=pending')).toEqual(['Abandoned', 'Never opened']);
    expect(await titles(c, 'reading=reading')).toEqual(['Read again', 'Reading now']);
    expect(await titles(c, 'reading=read')).toEqual(['Read once', 'Read, then abandoned']);
    expect((await c.get('/library')).body.total).toBe(6);
    expect((await c.get('/library?reading=abandoned')).status).toBe(400);
  });

  it('gives every edition of a work the work’s status, whatever copy was read', async () => {
    const { c, add } = await setup();
    const first = await add('Dune', { publisher: 'Ace', language: 'en' });
    const second = await c.post('/books', {
      workId: first.workId,
      edition: { publisher: 'Debolsillo', language: 'es' },
      copy: {},
    });
    expect(second.status).toBe(201);
    await read(c, first.copyId, 'read');

    const page = (await c.get('/library?reading=read')).body;
    expect(page.total).toBe(2);
    expect(page.items.map((i: { publisher: string }) => i.publisher).sort()).toEqual(['Ace', 'Debolsillo']);
    expect((await c.get('/library?reading=pending')).body.total).toBe(0);
    // Combined with other filters.
    expect(await titles(c, 'reading=read&language=es')).toEqual(['Dune']);
    expect((await c.get('/library?reading=read&language=fr')).body.total).toBe(0);
  });

  it('keeps the readings of a retired copy, as the detail does', async () => {
    const { c, add } = await setup();
    const book = await add('Niebla');
    await read(c, book.copyId, 'read');
    const other = await c.post('/copies', { editionId: book.editionId });
    expect(other.status).toBe(201);
    const retired = await c.patch(`/copies/${book.copyId}`, {
      baseVersion: 1,
      fields: { status: 'retired', retiredReason: 'gifted' },
    });
    expect(retired.status).toBe(200);
    expect(await titles(c, 'reading=read')).toEqual(['Niebla']);
  });

  it('lists only provisional editions with provisional=true', async () => {
    const { c, add } = await setup();
    await add('Complete');
    await add('ISBN 9788499891033', { metadataStatus: 'provisional' });
    expect(await titles(c, 'provisional=true')).toEqual(['ISBN 9788499891033']);
    expect(await titles(c, 'provisional=1&reading=pending')).toEqual(['ISBN 9788499891033']);
    expect((await c.get('/library?provisional=false')).body.total).toBe(2);
    expect((await c.get('/library?provisional=maybe')).status).toBe(400);
  });

  it('favorites works and returns their latest rating', async () => {
    const { c, add } = await setup();
    const dune = await add('Dune');
    await add('Emma');

    const fav = await c.post(`/works/${dune.workId}/favorite`);
    expect(fav.status).toBe(200);
    expect(fav.body.work.favorite).toBe(true);
    expect((await c.get(`/works/${dune.workId}`)).body.work.favorite).toBe(true);
    expect(await titles(c, 'favorite=true')).toEqual(['Dune']);
    expect(await titles(c, 'favorite=false')).toEqual(['Emma']);
    expect((await c.get('/library?favorite=true')).body.items[0]).toMatchObject({
      favorite: true,
      rating: null,
    });

    await c.post('/reading-sessions', { copyId: dune.copyId, status: 'read', rating: 4.5 });
    expect((await c.get('/library?favorite=true')).body.items[0].rating).toBe(4.5);

    const off = await c.del(`/works/${dune.workId}/favorite`);
    expect(off.body.work.favorite).toBe(false);
    expect((await c.get('/library?favorite=true')).body.total).toBe(0);
  });

  it('leaves out the sub-locations of a location with deep=false', async () => {
    const { c, add } = await setup();
    const room = (await c.post('/locations', { name: 'Room', kind: 'room', parentId: null })).body.items[0]
      .id;
    const shelf = (
      await c.post('/locations', { name: 'Shelf', kind: 'shelf', parentId: room })
    ).body.items.find((l: { name: string }) => l.name === 'Shelf').id;
    const inRoom = await add('In the room');
    const onShelf = await add('On the shelf');
    for (const [b, loc] of [
      [inRoom, room],
      [onShelf, shelf],
    ] as const)
      expect(
        (await c.patch(`/copies/${b.copyId}`, { baseVersion: 1, fields: { locationId: loc } })).status,
      ).toBe(200);
    expect(await titles(c, `location=${room}`)).toEqual(['In the room', 'On the shelf']);
    expect(await titles(c, `location=${room}&deep=true`)).toEqual(['In the room', 'On the shelf']);
    expect(await titles(c, `location=${room}&deep=false`)).toEqual(['In the room']);
  });
});
