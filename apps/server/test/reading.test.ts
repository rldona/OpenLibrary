import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@openlibrary/contracts';
import { makeApp, PASSWORD, webClient } from './helpers.js';

// The test clock starts on 2026-11-04 (helpers.ts).
const TODAY = '2026-11-04';

async function setup() {
  const ctx = await makeApp();
  const c = await webClient(ctx.app);
  const book = await c.post('/books', {
    work: { title: 'Niebla', authors: ['Miguel de Unamuno'] },
    edition: {},
    copy: {},
  });
  const copyId: string = book.body.editions[0].copies[0].id;
  return { ...ctx, c, workId: book.body.work.id as string, copyId };
}

describe('reading sessions', () => {
  it('start → read: dates are stamped and the work status follows (BR11, BR13)', async () => {
    const { c, workId, copyId } = await setup();
    expect((await c.get(`/works/${workId}`)).body).toMatchObject({ readingStatus: 'pending', readings: [] });

    const started = await c.post('/reading-sessions', { copyId, status: 'reading' });
    expect(started.status).toBe(201);
    expect(started.body.readingStatus).toBe('reading');
    const session = started.body.readings[0];
    expect(session).toMatchObject({
      copyId,
      status: 'reading',
      startedOn: TODAY,
      finishedOn: null,
      version: 1,
    });

    const done = await c.patch(`/reading-sessions/${session.id}`, {
      baseVersion: 1,
      fields: { status: 'read', rating: 4.5, notes: 'Augusto Pérez' },
    });
    expect(done.status).toBe(200);
    expect(done.body.readingStatus).toBe('read');
    expect(done.body.readings[0]).toMatchObject({
      status: 'read',
      startedOn: TODAY,
      finishedOn: TODAY,
      rating: 4.5,
      version: 2,
    });
  });

  it('resets a reading in progress to pending and clears its dates', async () => {
    const { c, workId, copyId } = await setup();
    const started = await c.post('/reading-sessions', { copyId, status: 'reading' });
    const session = started.body.readings[0];
    expect(session.startedOn).toBe(TODAY);

    const reset = await c.patch(`/reading-sessions/${session.id}`, {
      baseVersion: 1,
      fields: { status: 'pending', startedOn: null, finishedOn: null },
    });
    expect(reset.status).toBe(200);
    expect(reset.body.readingStatus).toBe('pending');
    expect(reset.body.readings[0]).toMatchObject({
      status: 'pending',
      startedOn: null,
      finishedOn: null,
      version: 2,
    });

    const again = await c.post('/reading-sessions', { copyId, status: 'reading' });
    expect(again.body.readings.map((r: { status: string }) => r.status)).toEqual(['pending', 'reading']);
    expect(again.body.readingStatus).toBe('reading');
    expect((await c.get(`/works/${workId}`)).body.readings).toHaveLength(2);
  });

  it('resets a finished reading and a reread to pending', async () => {
    const { c, workId, copyId } = await setup();
    await c.post('/reading-sessions', {
      copyId,
      status: 'read',
      startedOn: '2026-01-01',
      finishedOn: '2026-01-02',
    });
    const reread = await c.post('/reading-sessions', { copyId, status: 'reading' });
    expect(reread.body.readingStatus).toBe('reading');
    expect(reread.body.readings).toHaveLength(2);

    for (const r of reread.body.readings) {
      const res = await c.patch(`/reading-sessions/${r.id}`, {
        baseVersion: r.version,
        fields: { status: 'pending', startedOn: null, finishedOn: null },
      });
      expect(res.status).toBe(200);
    }

    const work = (await c.get(`/works/${workId}`)).body;
    expect(work.readingStatus).toBe('pending');
    expect(work.readings).toHaveLength(2);
    expect(
      work.readings.every(
        (r: { status: string; startedOn: string | null; finishedOn: string | null }) =>
          r.status === 'pending' && r.startedOn === null && r.finishedOn === null,
      ),
    ).toBe(true);
  });

  it('keeps dates the user gave and allows re-reading with a new session', async () => {
    const { c, workId, copyId } = await setup();
    const first = await c.post('/reading-sessions', {
      copyId,
      status: 'read',
      startedOn: '2019-07-01',
      finishedOn: '2019-07-20',
    });
    expect(first.body.readings[0]).toMatchObject({ startedOn: '2019-07-01', finishedOn: '2019-07-20' });

    const again = await c.post('/reading-sessions', { copyId, status: 'reading' });
    expect(again.body.readings.map((r: { status: string }) => r.status)).toEqual(['read', 'reading']);
    expect(again.body.readingStatus).toBe('reading');
    expect((await c.get(`/works/${workId}`)).body.readings).toHaveLength(2);
  });

  it('an abandoned reading leaves the work pending; a retired copy keeps its history (BR08)', async () => {
    const { c, workId, copyId } = await setup();
    const s = await c.post('/reading-sessions', { copyId, status: 'reading' });
    await c.patch(`/reading-sessions/${s.body.readings[0].id}`, {
      baseVersion: 1,
      fields: { status: 'abandoned' },
    });
    expect((await c.get(`/works/${workId}`)).body.readingStatus).toBe('pending');

    await c.patch(`/copies/${copyId}`, {
      baseVersion: 1,
      fields: { status: 'retired', retiredReason: 'gifted' },
    });
    const read = await c.post('/reading-sessions', { copyId, status: 'read' });
    expect(read.status).toBe(201);
    expect(read.body.readingStatus).toBe('read');
  });

  it('validates rating, status and the copy, in the client language', async () => {
    const { app, c, copyId } = await setup();
    expect((await c.post('/reading-sessions', { copyId, status: 'read', rating: 4.3 })).status).toBe(400);
    expect((await c.post('/reading-sessions', { copyId, status: 'read', rating: 0 })).status).toBe(400);
    expect((await c.post('/reading-sessions', { copyId, status: 'finished' })).status).toBe(400);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/reading-sessions',
      headers: { origin: 'https://biblioteca.test', 'accept-language': 'es' },
      cookies: { ol_session: c.token },
      payload: { copyId: uuidv7(), status: 'reading' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().detail).toBe('El ejemplar indicado no existe.');
  });

  it('readings sync: pulled after a web change, pushed idempotently from a device', async () => {
    const { app, c, copyId, workId } = await setup();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices',
      payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
    });
    const auth = { authorization: `Bearer ${reg.json().token}` };
    const snap = (await app.inject({ url: '/api/v1/sync/snapshot', headers: auth })).json();
    expect(snap.readings).toEqual([]);

    await c.post('/reading-sessions', { copyId, status: 'reading' });
    const page = (
      await app.inject({ url: `/api/v1/sync/pull?since=${snap.cursor}&epoch=${snap.epoch}`, headers: auth })
    ).json();
    expect(page.readings).toEqual([expect.objectContaining({ copyId, status: 'reading' })]);

    const op = {
      opId: uuidv7(),
      type: 'reading.create',
      reading: { id: uuidv7(), copyId, status: 'read', rating: 5 },
    };
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: auth,
        payload: { epoch: snap.epoch, ops: [op] },
      });
      expect(r.json().results[0].status).toBe(i ? 'duplicate' : 'applied');
    }
    expect((await c.get(`/works/${workId}`)).body.readings).toHaveLength(2);
  });
});
