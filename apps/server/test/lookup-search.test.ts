import { describe, expect, it } from 'vitest';
import { withCheckDigit } from '@openlibrary/contracts';
import { makeApp, webClient } from './helpers.js';
import type { Fetch } from '../src/lookup/providers.js';

const ISBN = withCheckDigit('978843222147');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The real Open Library result for "existe la suerte" by Taleb (trimmed to the fields we request). */
const TALEB_DOCS = [
  {
    key: '/works/OL26397010W',
    title: 'EXISTE LA SUERTE ?',
    author_name: ['Nassim Nicholas Taleb'],
    cover_i: 12344622,
    edition_key: ['OL35637692M'],
    first_publish_year: 2013,
    publisher: ['PAIDOS'],
    language: ['spa'],
  },
  {
    key: '/works/OL35155551W',
    title: '¿Existe la suerte?',
    author_name: ['Nassim Nicholas Taleb', 'Yago Moreno López'],
    cover_i: 14155805,
    edition_key: ['OL47538975M'],
    first_publish_year: 2015,
    publisher: ['Booket'],
    language: ['spa'],
  },
  {
    key: '/works/OL8697724W',
    title: 'Existe la Suerte?',
    subtitle: 'Enganados Por el Azar',
    author_name: ['Nassim Nicholas Taleb'],
    cover_i: 3334973,
  },
  {
    key: '/works/OL35155550W',
    title: '¿Existe la suerte?',
    author_name: ['Nassim Nicholas Taleb', 'Yago Moreno López'],
    cover_i: 14155804,
  },
];

const emptyGoogle = () => json({ totalItems: 0, items: [] });

describe('metadata search by title/author', () => {
  it('parses Open Library works and their covers, never inventing an ISBN', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('openlibrary.org/search.json')) return json({ numFound: 4, docs: TALEB_DOCS });
      if (url.includes('googleapis.com/books')) return emptyGoogle();
      return new Response('no', { status: 404 });
    }) as Fetch;
    const { app } = await makeApp({ fetch: fetchImpl });
    const c = await webClient(app);

    const r = await c.get('/lookup/search?title=existe%20la%20suerte&author=taleb');
    expect(r.status).toBe(200);
    expect(r.body.query).toEqual({ title: 'existe la suerte', author: 'taleb' });
    expect(r.body.sources).toEqual(['Open Library', 'Google Books']);
    expect(r.body.errors).toEqual([]);

    const covers = r.body.candidates.map((x: { coverUrl: string | null }) => x.coverUrl);
    expect(covers).toContain('https://covers.openlibrary.org/b/id/12344622-L.jpg');
    expect(covers).toContain('https://covers.openlibrary.org/b/id/14155805-L.jpg');
    for (const candidate of r.body.candidates as { isbn13: string | null; authors: string[] }[]) {
      expect(candidate.isbn13).toBeNull();
      expect(candidate.authors).toContain('Nassim Nicholas Taleb');
    }

    // The Open Library request asks for the fields we parse, capped at 10.
    const ol = new URL(calls.find((u) => u.includes('openlibrary.org/search.json'))!);
    expect(ol.searchParams.get('title')).toBe('existe la suerte');
    expect(ol.searchParams.get('author')).toBe('taleb');
    expect(ol.searchParams.get('limit')).toBe('10');
  });

  it('keeps Open Library works and Google Books volumes apart when there is no shared ISBN', async () => {
    const googleUrls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('openlibrary.org/search.json')) {
        return json({ numFound: 2, docs: TALEB_DOCS.slice(0, 2) });
      }
      if (url.includes('googleapis.com/books')) {
        googleUrls.push(url);
        return json({
          items: [
            {
              volumeInfo: {
                title: '¿Existe la suerte?',
                authors: ['Nassim Nicholas Taleb'],
                industryIdentifiers: [{ type: 'ISBN_13', identifier: ISBN }],
                imageLinks: { thumbnail: 'https://books.google.com/books/content?id=x&zoom=1' },
              },
            },
          ],
        });
      }
      return new Response('no', { status: 404 });
    }) as Fetch;
    const { app } = await makeApp({ fetch: fetchImpl });
    const c = await webClient(app);

    const r = await c.get('/lookup/search?title=%C2%BFExiste%20la%20suerte%3F&author=Taleb');
    expect(r.status).toBe(200);
    // The two Open Library editions keep their own covers; the Google Books volume is a third option.
    expect(r.body.candidates).toHaveLength(3);
    const openLibrary = r.body.candidates.filter((x: { isbn13: string | null }) => x.isbn13 === null);
    const google = r.body.candidates.filter((x: { isbn13: string | null }) => x.isbn13 !== null);
    expect(openLibrary).toHaveLength(2);
    expect(google).toHaveLength(1);
    expect(google[0].sources).toEqual(['Google Books']);
    expect(openLibrary.every((x: { sources: string[] }) => x.sources.join() === 'Open Library')).toBe(true);

    // Punctuation from the cover does not reach Google's fielded query.
    const q = new URL(googleUrls[0]!).searchParams.get('q');
    expect(q).toContain('intitle:Existe la suerte');
    expect(q).not.toContain('¿');
  });

  it('uses the exact Google Books volume ISBN and marks it as owned', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('openlibrary.org/search.json')) return json({ numFound: 0, docs: [] });
      if (url.includes('googleapis.com/books')) {
        return json({
          items: [
            {
              volumeInfo: {
                title: 'La ridícula idea de no volver a verte',
                authors: ['Rosa Montero'],
                publisher: 'Seix Barral',
                publishedDate: '2013',
                language: 'es',
                industryIdentifiers: [{ type: 'ISBN_13', identifier: ISBN }],
                imageLinks: {
                  thumbnail: 'http://books.google.com/books/content?id=x&edge=curl&source=gbs_api',
                },
              },
            },
          ],
        });
      }
      return new Response('no', { status: 404 });
    }) as Fetch;
    const { app } = await makeApp({ fetch: fetchImpl });
    const c = await webClient(app);

    const before = await c.get('/lookup/search?title=ridicula');
    expect(before.body.candidates).toHaveLength(1);
    expect(before.body.candidates[0]).toMatchObject({
      title: 'La ridícula idea de no volver a verte',
      isbn13: ISBN,
      owned: false,
      coverUrl: 'https://books.google.com/books/content?id=x&source=gbs_api',
    });

    await c.post('/books', { work: { title: 'Ridícula' }, edition: { isbn13: ISBN }, copy: {} });
    const after = await c.get('/lookup/search?title=ridicula');
    expect(after.body.candidates[0]).toMatchObject({ isbn13: ISBN, owned: true });
  });

  it('retries with the title alone when title+author finds nothing', async () => {
    const openLibraryUrls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('openlibrary.org/search.json')) {
        openLibraryUrls.push(url);
        const withAuthor = new URL(url).searchParams.has('author');
        return withAuthor ? json({ numFound: 0, docs: [] }) : json({ numFound: 1, docs: [TALEB_DOCS[0]] });
      }
      if (url.includes('googleapis.com/books')) return emptyGoogle();
      return new Response('no', { status: 404 });
    }) as Fetch;
    const { app } = await makeApp({ fetch: fetchImpl });
    const c = await webClient(app);

    const r = await c.get('/lookup/search?title=existe%20la%20suerte&author=taleb');
    expect(r.status).toBe(200);
    expect(r.body.candidates.length).toBeGreaterThan(0);
    expect(openLibraryUrls).toHaveLength(2);
    expect(new URL(openLibraryUrls[0]!).searchParams.has('author')).toBe(true);
    expect(new URL(openLibraryUrls[1]!).searchParams.has('author')).toBe(false);
  });

  it('does not retry when every provider failed', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return new Response('boom', { status: 500 });
    }) as Fetch;
    const { app } = await makeApp({ fetch: fetchImpl });
    const c = await webClient(app);

    const r = await c.get('/lookup/search?title=existe%20la%20suerte&author=taleb');
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(r.body.candidates).toEqual([]);
    expect(r.body.sources).toEqual([]);
    expect(r.body.errors).toHaveLength(2);
  });

  it('keeps the other provider when one fails', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('openlibrary.org/search.json')) return new Response('boom', { status: 500 });
      if (url.includes('googleapis.com/books')) {
        return json({
          items: [
            {
              volumeInfo: {
                title: 'La ridícula idea de no volver a verte',
                authors: ['Rosa Montero'],
              },
            },
          ],
        });
      }
      return new Response('no', { status: 404 });
    }) as Fetch;
    const { app } = await makeApp({ fetch: fetchImpl });
    const c = await webClient(app);

    const r = await c.get('/lookup/search?title=ridicula');
    expect(r.status).toBe(200);
    expect(r.body.candidates).toHaveLength(1);
    expect(r.body.sources).toEqual(['Google Books']);
    expect(r.body.errors).toEqual(['Open Library: HTTP 500']);
  });

  it('requires a title or an author', async () => {
    const { app } = await makeApp();
    const c = await webClient(app);
    expect((await c.get('/lookup/search')).status).toBe(400);
    expect((await c.get('/lookup/search?title=%20%20')).status).toBe(400);
    expect((await c.get(`/lookup/search?title=${'a'.repeat(201)}`)).status).toBe(400);
  });

  it('rejects repeated query parameters instead of failing with a 500', async () => {
    const { app } = await makeApp();
    const c = await webClient(app);
    const title = await c.get('/lookup/search?title=a&title=b');
    expect(title.status).toBe(400);
    expect(title.body.code).toBe('validation');
    expect((await c.get('/lookup/search?author=a&author=b')).status).toBe(400);
  });

  it('is authenticated', async () => {
    const { app } = await makeApp();
    const r = await app.inject('/api/v1/lookup/search?title=existe');
    expect(r.statusCode).toBe(401);
  });
});
