import fs from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { withCheckDigit } from '@openlibrary/contracts';
import { makeApp, ORIGIN, webClient } from './helpers.js';
import type { Fetch } from '../src/lookup/providers.js';

const ISBN = withCheckDigit('978843222147');
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Fake providers: Open Library gives title/author/cover; Google Books adds synopsis and language. */
function fakeProviders(calls: string[] = []): Fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('openlibrary.org/api/books')) {
      return json({
        [`ISBN:${ISBN}`]: {
          title: 'La ridícula idea de no volver a verte',
          authors: [{ name: 'Rosa Montero' }],
          publishers: [{ name: 'Seix Barral' }],
          publish_date: 'octubre 2013',
          number_of_pages: 240,
          subjects: [{ name: 'Duelo' }],
          cover: { large: 'https://covers.openlibrary.org/b/id/1-L.jpg' },
        },
      });
    }
    if (url.includes('googleapis.com/books')) {
      return json({
        items: [
          {
            volumeInfo: {
              title: 'La ridícula idea…',
              description: 'Sobre Marie Curie y el duelo.',
              language: 'es',
            },
          },
        ],
      });
    }
    return new Response('no', { status: 404 });
  }) as Fetch;
}

describe('ISBN lookup in providers', () => {
  it('merges Open Library and Google Books and caches the result', async () => {
    const calls: string[] = [];
    const { app } = await makeApp({ fetch: fakeProviders(calls) });
    const c = await webClient(app);
    const r = await c.get(`/lookup/isbn/${ISBN}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      found: true,
      sources: ['Open Library', 'Google Books'],
      existing: null,
      proposal: {
        title: 'La ridícula idea de no volver a verte',
        authors: ['Rosa Montero'],
        publisher: 'Seix Barral',
        publishedYear: 2013,
        pages: 240,
        language: 'es',
        description: 'Sobre Marie Curie y el duelo.',
        coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg',
      },
    });
    const n = calls.length;
    await c.get(`/lookup/isbn/${ISBN}`);
    expect(calls.length).toBe(n); // second time: cache
  });

  it('offline it does not fail: it reports the error and allows manual entry', async () => {
    const { app } = await makeApp();
    const c = await webClient(app);
    const r = await c.get(`/lookup/isbn/${ISBN}`);
    expect(r.status).toBe(200);
    expect(r.body.found).toBe(false);
    expect(r.body.errors).toHaveLength(2);
  });

  it('detects that you already own the edition', async () => {
    const { app } = await makeApp({ fetch: fakeProviders() });
    const c = await webClient(app);
    const b = await c.post('/books', { work: { title: 'Montero' }, edition: { isbn13: ISBN }, copy: {} });
    const r = await c.get(`/lookup/isbn/${ISBN}`);
    expect(r.body.existing).toEqual({
      editionId: b.body.created.editionId,
      workId: b.body.work.id,
      title: 'Montero',
      copies: 1,
    });
  });

  it('rejects codes that are not ISBNs', async () => {
    const { app } = await makeApp();
    const c = await webClient(app);
    expect((await c.get('/lookup/isbn/9770212345007')).status).toBe(400);
  });
});

describe('covers', () => {
  const png = () =>
    sharp({ create: { width: 300, height: 450, channels: 3, background: '#8a3b12' } })
      .png()
      .toBuffer();

  it('idempotent upload, thumbnail and authenticated download', async () => {
    const { app, dataDir } = await makeApp();
    const c = await webClient(app);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { password: 'correct horse battery staple' },
    });
    const cookie = login.cookies.find((x) => x.name === 'ol_session')!.value;
    const img = await png();
    const up = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/assets',
        headers: { origin: ORIGIN, 'content-type': 'image/png' },
        cookies: { ol_session: cookie },
        payload: img,
      });
    const a = await up();
    expect(a.statusCode).toBe(201);
    const asset = a.json();
    expect(asset).toMatchObject({ mime: 'image/jpeg', width: 300, height: 450 });
    expect((await up()).json().id).toBe(asset.id);
    expect(fs.existsSync(`${dataDir}/assets/${asset.id.slice(0, 2)}/${asset.id}.thumb.jpg`)).toBe(true);

    const book = await c.post('/books', {
      work: { title: 'Con portada' },
      edition: { coverAssetId: asset.id },
      copy: {},
    });
    expect(book.body.editions[0].coverAssetId).toBe(asset.id);

    const get = await app.inject({ url: `/api/v1/assets/${asset.id}`, cookies: { ol_session: cookie } });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/jpeg');
    expect((await app.inject(`/api/v1/assets/${asset.id}`)).statusCode).toBe(401);
  });

  it('rejects non-image files and missing covers', async () => {
    const { app } = await makeApp();
    const c = await webClient(app);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { password: 'correct horse battery staple' },
    });
    const cookie = login.cookies.find((x) => x.name === 'ol_session')!.value;
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { origin: ORIGIN, 'content-type': 'image/jpeg' },
      cookies: { ol_session: cookie },
      payload: Buffer.from('hola'),
    });
    expect(bad.statusCode).toBe(400);
    const missing = await c.post('/books', {
      work: { title: 'X' },
      edition: { coverAssetId: 'a'.repeat(64) },
      copy: {},
    });
    expect(missing.status).toBe(400);
  });

  it('downloads covers only from allowed providers', async () => {
    const img = await png();
    const fetchImpl = (async (u: string | URL) => {
      const url = String(u);
      if (url.startsWith('https://covers.openlibrary.org/'))
        return new Response(null, {
          status: 302,
          headers: { location: 'https://ia800.us.archive.org/x.jpg' },
        });
      if (url.startsWith('https://ia800.us.archive.org/'))
        return new Response(new Uint8Array(img), { status: 200 });
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } });
    }) as Fetch;
    const { app } = await makeApp({ fetch: fetchImpl });
    const c = await webClient(app);
    const ok = await c.post('/assets/fetch', { url: 'https://covers.openlibrary.org/b/id/1-L.jpg' });
    expect(ok.status).toBe(201);
    expect((await c.post('/assets/fetch', { url: 'https://evil.example/x.jpg' })).status).toBe(400);
    expect((await c.post('/assets/fetch', { url: 'http://covers.openlibrary.org/x.jpg' })).status).toBe(400);
  });
});
