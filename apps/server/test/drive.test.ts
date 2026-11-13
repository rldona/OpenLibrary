import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { filesToPrune, KEEP_DAYS, KEEP_RECENT, ROOT_FOLDER } from '../src/drive/service.js';
import type { Fetch } from '../src/lookup/providers.js';
import { makeApp, ORIGIN, webClient } from './helpers.js';

const GOOGLE = { GOOGLE_OAUTH_CLIENT_ID: 'client-123', GOOGLE_OAUTH_CLIENT_SECRET: 'secret-456' };

type FakeFile = {
  id: string;
  name: string;
  parents: string[];
  folder: boolean;
  data: Buffer;
  trashed: boolean;
};

/** In-memory imitation of the Google OAuth and Drive v3 endpoints the app uses. */
function fakeGoogle() {
  const files = new Map<string, FakeFile>();
  const state = {
    revoked: new Set<string>(),
    validAccess: new Set<string>(),
    seq: 0,
    uploads: 0,
    down: false,
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const newId = () => `f${++state.seq}`;

  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    if (state.down) throw new TypeError('fetch failed');
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = init.body as string | Buffer | undefined;

    if (url.href === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(body));
      const rt =
        form.get('grant_type') === 'authorization_code'
          ? `rt-${form.get('code')}`
          : form.get('refresh_token')!;
      if (form.get('code') === 'bad' || state.revoked.has(rt)) return json({ error: 'invalid_grant' }, 400);
      const at = `at-${++state.seq}`;
      state.validAccess.add(at);
      return json({ access_token: at, expires_in: 3600, ...(form.get('code') ? { refresh_token: rt } : {}) });
    }
    if (url.href === 'https://oauth2.googleapis.com/revoke') {
      state.revoked.add(new URLSearchParams(String(body)).get('token')!);
      return new Response('', { status: 200 });
    }

    const auth = (init.headers as Record<string, string>).authorization?.slice(7);
    if (!auth || !state.validAccess.has(auth)) return json({ error: 'unauthorized' }, 401);

    if (url.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'owner@example.com' } });

    const one = url.pathname.match(/^\/drive\/v3\/files\/(.+)$/);
    if (one) {
      const f = files.get(decodeURIComponent(one[1]!));
      if (!f) return json({ error: 'not found' }, 404);
      if (url.searchParams.get('alt') === 'media')
        return new Response(new Uint8Array(f.data), { status: 200 });
      if (method === 'DELETE') {
        files.delete(f.id);
        return new Response(null, { status: 204 });
      }
      return json({ id: f.id, trashed: f.trashed });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(String(body)) as { name: string; parents?: string[] };
      const f = {
        id: newId(),
        name: meta.name,
        parents: meta.parents ?? ['root'],
        folder: true,
        data: Buffer.alloc(0),
        trashed: false,
      };
      files.set(f.id, f);
      return json({ id: f.id });
    }
    if (url.pathname === '/drive/v3/files') {
      const query = url.searchParams.get('q')!;
      const parent = /'([^']+)' in parents/.exec(query)![1]!;
      const name = /name = '([^']+)'/.exec(query)?.[1];
      const items = [...files.values()].filter(
        (f) =>
          f.parents.includes(parent) &&
          !f.trashed &&
          (!name || f.name === name) &&
          (!query.includes('mimeType') || f.folder),
      );
      return json({ files: items.map((f) => ({ id: f.id, name: f.name })) });
    }
    if (url.pathname === '/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'multipart') {
      const raw = body as Buffer;
      const boundary = /boundary=(\S+)/.exec((init.headers as Record<string, string>)['content-type']!)![1]!;
      const parts = raw.toString('latin1').split(`--${boundary}`);
      const meta = JSON.parse(parts[1]!.split('\r\n\r\n')[1]!.trim()) as { name: string; parents: string[] };
      const start = raw.indexOf('\r\n\r\n', raw.indexOf(`--${boundary}`, 10)) + 4;
      const end = raw.lastIndexOf(`\r\n--${boundary}--`);
      const f = {
        id: newId(),
        name: meta.name,
        parents: meta.parents,
        folder: false,
        data: raw.subarray(start, end),
        trashed: false,
      };
      files.set(f.id, f);
      state.uploads++;
      return json({ id: f.id, name: f.name });
    }
    return json({ error: `unexpected ${method} ${url.href}` }, 500);
  }) as Fetch;

  const byName = (name: string) => [...files.values()].find((f) => f.name === name);
  const inFolder = (id: string) => [...files.values()].filter((f) => f.parents.includes(id));
  return { fetchImpl, files, state, byName, inFolder };
}

async function setup(env: Record<string, string> = GOOGLE) {
  const google = fakeGoogle();
  const ctx = await makeApp({ env, fetch: google.fetchImpl });
  const c = await webClient(ctx.app);
  return { ...ctx, c, google };
}

async function connect(s: Awaited<ReturnType<typeof setup>>, code = 'good') {
  const { url } = (await s.c.post('/backups/drive/connect')).body as { url: string };
  const state = new URL(url).searchParams.get('state')!;
  const r = await s.app.inject({
    method: 'GET',
    url: `/api/v1/backups/drive/callback?code=${code}&state=${state}`,
  });
  return { url, state, location: r.headers.location, status: r.statusCode };
}

async function addBookWithCover(s: Awaited<ReturnType<typeof setup>>, title: string) {
  const img = await sharp({ create: { width: 300, height: 450, channels: 3, background: '#8a5' } })
    .png()
    .toBuffer();
  const up = await s.app.inject({
    method: 'POST',
    url: '/api/v1/assets',
    headers: { origin: ORIGIN, 'content-type': 'image/png' },
    cookies: { ol_session: s.c.token },
    payload: img,
  });
  const r = await s.c.post('/books', { work: { title }, edition: { coverAssetId: up.json().id }, copy: {} });
  expect(r.status).toBe(201);
}

describe('backups to Google Drive', () => {
  it('without Google credentials the feature reports it is not available', async () => {
    const s = await setup({});
    expect((await s.c.get('/backups/drive')).body).toMatchObject({
      drive: { available: false, connected: false },
      intervalMinutes: 0,
    });
    const r = await s.c.post('/backups/drive/connect');
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('drive-not-configured');
  });

  it('requires a session', async () => {
    const s = await setup();
    const r = await s.app.inject({ method: 'GET', url: '/api/v1/backups/drive' });
    expect(r.statusCode).toBe(401);
  });

  it('connects through Google consent; the token is kept out of the database', async () => {
    const s = await setup();
    const { url, state, status, location } = await connect(s);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe('client-123');
    expect(u.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/v1/backups/drive/callback`);
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(status).toBe(302);
    expect(location).toBe('/data?drive=connected');

    expect((await s.c.get('/backups/drive')).body.drive).toEqual({
      available: true,
      connected: true,
      account: 'owner@example.com',
    });
    expect((fs.statSync(s.config.driveStateFile).mode & 0o777).toString(8)).toBe('600');
    const meta = s.db.$client.prepare('SELECT value FROM meta').all() as { value: string }[];
    expect(meta.some((m) => m.value.includes('rt-good'))).toBe(false);

    // The state is single-use.
    const again = await s.app.inject({
      method: 'GET',
      url: `/api/v1/backups/drive/callback?code=good&state=${state}`,
    });
    expect(again.headers.location).toBe('/data?drive=expired');
  });

  it('rejects unknown states, refused consent and failed exchanges', async () => {
    const s = await setup();
    const forged = await s.app.inject({
      method: 'GET',
      url: '/api/v1/backups/drive/callback?code=good&state=forged',
    });
    expect(forged.headers.location).toBe('/data?drive=expired');

    const { url } = (await s.c.post('/backups/drive/connect')).body as { url: string };
    const st = new URL(url).searchParams.get('state')!;
    const denied = await s.app.inject({
      method: 'GET',
      url: `/api/v1/backups/drive/callback?error=access_denied&state=${st}`,
    });
    expect(denied.headers.location).toBe('/data?drive=denied');

    expect((await connect(s, 'bad')).location).toBe('/data?drive=failed');
    expect((await s.c.get('/backups/drive')).body.drive.connected).toBe(false);
  });

  it('backs up the database and the covers; covers are uploaded only once', async () => {
    const s = await setup();
    await addBookWithCover(s, 'La Regenta');
    expect((await s.c.post('/backups/drive/run')).status).toBe(409); // not connected yet
    await connect(s);
    expect((await s.c.get('/backups/drive')).body.upToDate).toBe(false);

    const r = await s.c.post('/backups/drive/run');
    expect(r.status).toBe(202);
    expect(r.body.running).toBe(true);
    await s.app.drive.idle();

    const st = (await s.c.get('/backups/drive')).body;
    expect(st).toMatchObject({ running: false, upToDate: true, lastError: null });
    expect(st.lastFile).toMatch(/^library-2026-11-04T10-00-00Z\.db\.gz$/);

    const root = s.google.byName(ROOT_FOLDER)!;
    expect(root.folder).toBe(true);
    const dbFile = s.google.byName(st.lastFile)!;
    expect(dbFile.parents).toEqual([root.id]);
    expect(gunzipSync(dbFile.data).subarray(0, 15).toString()).toBe('SQLite format 3');
    const covers = s.google.byName('covers')!;
    expect(
      s.google
        .inFolder(covers.id)
        .map((f) => f.name)
        .sort(),
    ).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}\.jpg$/),
      expect.stringMatching(/^[0-9a-f]{64}\.thumb\.jpg$/),
    ]);

    // Second backup: new database file, no covers uploaded again.
    s.advance(60_000);
    const before = s.google.state.uploads;
    expect(await s.app.drive.run()).toMatchObject({ coversUploaded: 0 });
    expect(s.google.state.uploads).toBe(before + 1);
    expect(s.google.inFolder(covers.id)).toHaveLength(2);
  });

  it('a second run while one is in progress is refused', async () => {
    const s = await setup();
    await connect(s);
    const first = s.app.drive.run();
    const r = await s.c.post('/backups/drive/run');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('backup-running');
    await first;
  });

  it('automatic: only when due and only if the library changed', async () => {
    const s = await setup();
    await connect(s);
    expect((await s.c.put('/backups/drive/settings', { intervalMinutes: 7 })).status).toBe(400);
    expect(await s.app.drive.tick()).toBeNull(); // manual only by default

    const set = await s.c.put('/backups/drive/settings', { intervalMinutes: 5 });
    expect(set.body.intervalMinutes).toBe(5);
    expect(await s.app.drive.tick()).not.toBeNull(); // never backed up: runs now
    expect((await s.c.get('/backups/drive')).body.nextCheckAt).toBe('2026-11-04T10:05:00.000Z');

    s.advance(2 * 60_000);
    await s.c.post('/books', { work: { title: 'Fortunata y Jacinta' }, edition: {}, copy: {} });
    expect(await s.app.drive.tick()).toBeNull(); // not due yet
    s.advance(3 * 60_000);
    expect((await s.c.get('/backups/drive')).body.upToDate).toBe(false);
    expect(await s.app.drive.tick()).toMatchObject({ file: 'library-2026-11-04T10-05-00Z.db.gz' });

    s.advance(10 * 60_000);
    expect(await s.app.drive.tick()).toBeNull(); // nothing changed: no upload
  });

  it('a revoked authorisation is reported (translated) and retried on the next tick', async () => {
    const s = await setup();
    await connect(s);
    s.google.state.revoked.add('rt-good');
    s.google.state.validAccess.clear();
    await expect(s.app.drive.run()).rejects.toThrow('errors.driveReconnect');
    const es = await s.app.inject({
      method: 'GET',
      url: '/api/v1/backups/drive',
      headers: { 'accept-language': 'es' },
      cookies: { ol_session: s.c.token },
    });
    expect(es.json().lastError).toBe('Google Drive ya no acepta la autorización. Vuelve a conectarlo.');

    s.google.state.down = true;
    await s.c.put('/backups/drive/settings', { intervalMinutes: 1 });
    s.advance(60_000);
    expect(await s.app.drive.tick()).toBeNull(); // attempted (failed), not skipped
    expect((await s.c.get('/backups/drive')).body.lastError).toBe('Google Drive cannot be reached.');
  });

  it('recreates the folder if it was deleted from Drive', async () => {
    const s = await setup();
    await connect(s);
    await s.app.drive.run();
    const root = s.google.byName(ROOT_FOLDER)!;
    s.google.files.delete(root.id);
    s.advance(60_000);
    await s.app.drive.run();
    expect(s.google.byName(ROOT_FOLDER)!.id).not.toBe(root.id);
  });

  it('reconnecting finds the existing folder instead of creating another', async () => {
    const s = await setup();
    await connect(s);
    await s.app.drive.run();
    await s.c.del('/backups/drive');
    s.google.state.revoked.clear();
    await connect(s);
    s.advance(60_000);
    await s.app.drive.run();
    const roots = [...s.google.files.values()].filter((f) => f.name === ROOT_FOLDER);
    expect(roots).toHaveLength(1);
    expect(s.google.inFolder(roots[0]!.id).filter((f) => f.name.endsWith('.db.gz'))).toHaveLength(2);
  });

  it('drive-fetch: a new installation gets the newest copy and the covers back', async () => {
    const s = await setup();
    await addBookWithCover(s, 'La Regenta');
    await connect(s);
    await s.app.drive.run();
    s.advance(60_000);
    await s.c.post('/books', { work: { title: 'Fortunata y Jacinta' }, edition: {}, copy: {} });
    const newest = await s.app.drive.run();

    // Another server (empty volume) connected to the same Google account.
    const other = await makeApp({ env: GOOGLE, fetch: s.google.fetchImpl });
    await connect({ ...other, c: await webClient(other.app), google: s.google });
    const r = await other.app.drive.fetchBackup();
    expect(r.file).toBe(newest.file);
    expect(r.coversDownloaded).toBe(2);
    const restored = new Database(r.path, { readonly: true });
    const titles = (
      restored.prepare('SELECT title FROM works ORDER BY title').all() as { title: string }[]
    ).map((w) => w.title);
    restored.close();
    expect(titles).toEqual(['Fortunata y Jacinta', 'La Regenta']);
    const covers = fs.readdirSync(other.config.assetsDir, { recursive: true }).map(String);
    expect(covers.filter((f) => f.endsWith('.jpg'))).toHaveLength(2);

    await expect(other.app.drive.fetchBackup('library-1999-01-01T00-00-00Z.db.gz')).rejects.toThrow(
      'is not in Google Drive',
    );
  });

  it('disconnecting revokes the token and deletes it', async () => {
    const s = await setup();
    await connect(s);
    const r = await s.c.del('/backups/drive');
    expect(r.body.drive.connected).toBe(false);
    expect(fs.existsSync(s.config.driveStateFile)).toBe(false);
    expect(s.google.state.revoked.has('rt-good')).toBe(true);
  });
});

describe('retention of database copies', () => {
  const name = (d: Date) => ({
    name: `library-${d
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z')
      .replace(/:/g, '-')}.db.gz`,
  });

  it('keeps the newest copies plus one per day, and ignores other files', () => {
    const start = new Date('2026-09-01T00:00:00Z').getTime();
    // 60 days, 10 copies per day.
    const files = Array.from({ length: 600 }, (_, i) =>
      name(new Date(start + Math.floor(i / 10) * 86_400_000 + (i % 10) * 60_000)),
    );
    const prune = filesToPrune([...files, { name: 'covers' }, { name: 'notes.txt' }]);
    const kept = files.filter((f) => !prune.includes(f));
    // 24 newest (the last 2.4 days) + one per day for 30 days, overlapping on the 3 newest days.
    expect(kept).toHaveLength(KEEP_RECENT + KEEP_DAYS - 3);
    expect(kept.map((f) => f.name)).toContain(files[599]!.name);
    expect(prune.map((f) => f.name)).not.toContain('covers');
    expect(filesToPrune(files.slice(0, 5))).toEqual([]);
  });
});
