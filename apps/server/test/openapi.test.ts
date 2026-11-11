/**
 * Contract test: real server responses conform to packages/contracts/openapi.yaml,
 * the file Android generates its client from. Records are `additionalProperties: false`,
 * so a new column on the server fails here until the spec (and Android) know about it.
 *
 * It also keeps packages/contracts/fixtures/ (real responses) valid; the Android unit tests decode
 * them strictly. Regenerate them with `UPDATE_FIXTURES=1 npx vitest run test/openapi.test.ts`.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';
import { uuidv7, withCheckDigit } from '@openlibrary/contracts';
import type { Fetch } from '../src/lookup/providers.js';
import { bumpEpoch } from '../src/db/client.js';
import { makeApp, ORIGIN, PASSWORD, webClient } from './helpers.js';
import { VirtualAuthenticator } from './webauthn.js';

const SPEC_FILE = fileURLToPath(new URL('../../../packages/contracts/openapi.yaml', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../../packages/contracts/fixtures/', import.meta.url));
const FIXTURE_SCHEMAS = {
  'snapshot.json': 'SyncSnapshot',
  'pull.json': 'SyncPullPage',
  'push.json': 'SyncPushResponse',
  'lookup.json': 'LookupResult',
  'search.json': 'MetadataSearchResult',
  'asset.json': 'Asset',
  'stats.json': 'Stats',
  'auth-methods.json': 'AuthMethods',
  'passkey-options.json': 'CeremonyOptions',
} as const;

const writeFixtures = (files: Record<string, unknown>) => {
  if (!process.env.UPDATE_FIXTURES) return;
  fs.mkdirSync(FIXTURES, { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    fs.writeFileSync(`${FIXTURES}${file}`, JSON.stringify(body, null, 2) + '\n');
  }
};
const spec = parseYaml(fs.readFileSync(SPEC_FILE, 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, object> };
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema({ $id: 'openapi', components: spec.components });

function expectSchema(name: string, body: unknown) {
  const validate = ajv.getSchema(`openapi#/components/schemas/${name}`);
  if (!validate) throw new Error(`schema ${name} is not in openapi.yaml`);
  const ok = validate(body);
  expect(ok, `${name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
}

describe('openapi.yaml: passkeys', () => {
  it('device registration with a passkey and the passkey-required problem match the spec', async () => {
    const { app } = await makeApp();
    const web = await webClient(app);
    const key = new VirtualAuthenticator(ORIGIN, new URL(ORIGIN).hostname);
    const reg = await web.post('/auth/passkeys/options', { password: PASSWORD });
    await web.post('/auth/passkeys/verify', {
      ceremonyId: reg.body.ceremonyId,
      response: key.register(reg.body.options),
    });

    const refused = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices',
      payload: { password: PASSWORD, name: 'Pixel 8' },
    });
    expect(refused.statusCode).toBe(403);
    expectSchema('Problem', refused.json());
    expect(refused.json().code).toBe('passkey-required');

    const o = await app.inject({ method: 'POST', url: '/api/v1/auth/login/passkey/options' });
    expectSchema('CeremonyOptions', o.json());
    const device = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices/passkey',
      payload: { ceremonyId: o.json().ceremonyId, response: key.login(o.json().options), name: 'Pixel 8' },
    });
    expect(device.statusCode).toBe(201);
    expectSchema('DeviceRegisterResponse', device.json());
  });
});

describe('openapi.yaml', () => {
  it('responses of every Android endpoint match the spec', async () => {
    const { app, db } = await makeApp();
    const web = await webClient(app);
    const call = async (
      url: string,
      opts: { method?: 'GET' | 'POST'; token?: string; payload?: object } = {},
    ) => {
      const r = await app.inject({
        method: opts.method ?? 'GET',
        url: `/api/v1${url}`,
        headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
        ...(opts.payload ? { payload: opts.payload } : {}),
      });
      return { status: r.statusCode, body: r.json() as Record<string, unknown> };
    };

    // Some data: a location, a book, a retired copy and a deleted edition.
    const home = uuidv7();
    await web.post('/locations', { id: home, parentId: null, name: 'Casa', kind: 'home' });
    const book = await web.post('/books', {
      work: { title: 'Niebla', authors: ['Miguel de Unamuno'], series: 'Nivolas', seriesIndex: 1 },
      edition: { publisher: 'Cátedra', publishedYear: 1914, pages: 320, language: 'es' },
      copy: { locationId: home, acquiredOn: '2020-05-01', priceCents: 1200 },
    });
    const copy = book.body.editions[0].copies[0];
    await web.patch(`/copies/${copy.id}`, {
      baseVersion: 1,
      fields: { status: 'retired', retiredReason: 'gifted' },
    });
    const other = await web.post('/books', { work: { title: 'Paz en la guerra' }, edition: {}, copy: {} });
    // A finished reading with rating and one in progress, so the fixtures carry both shapes.
    await web.post('/reading-sessions', {
      copyId: copy.id,
      status: 'read',
      startedOn: '2024-01-02',
      rating: 4.5,
      notes: 'Nivola',
    });
    await web.post('/reading-sessions', { copyId: copy.id, status: 'reading' });
    // A quote from a page of a copy, and one without page that is deleted after the snapshot (tombstone).
    await web.post('/quotes', {
      workId: book.body.work.id,
      text: 'Mi vida es una niebla.',
      page: 12,
      copyId: copy.id,
    });
    const doomed = await web.post('/quotes', { workId: book.body.work.id, text: 'Borrar' });
    // An open wish and one already bought (linked to its copy).
    await web.post('/wishlist', {
      title: 'San Manuel Bueno, mártir',
      authors: ['Miguel de Unamuno'],
      priority: 'high',
    });
    await web.post('/wishlist', {
      title: 'Niebla',
      isbn13: '9788437604947',
      status: 'acquired',
      acquiredCopyId: copy.id,
    });
    // And one you no longer want, deleted after the snapshot (tombstone).
    const unwanted = await web.post('/wishlist', { title: 'Amor y pedagogía' });

    expectSchema('HealthResponse', (await call('/health')).body);
    const methods = (await call('/auth/methods')).body;
    expectSchema('AuthMethods', methods);
    const passkeyOptions = await call('/auth/login/passkey/options', { method: 'POST' });
    expectSchema('CeremonyOptions', passkeyOptions.body);
    writeFixtures({ 'auth-methods.json': methods, 'passkey-options.json': passkeyOptions.body });

    const reg = await call('/auth/devices', {
      method: 'POST',
      payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
    });
    expect(reg.status).toBe(201);
    expectSchema('DeviceRegisterResponse', reg.body);
    const token = reg.body.token as string;

    expectSchema('SessionInfo', (await call('/auth/me', { token })).body);

    const snap = await call('/sync/snapshot', { token });
    expectSchema('SyncSnapshot', snap.body);
    // Statistics of exactly the snapshot's data: the Android app must compute the same from it.
    const stats = await call('/stats', { token });
    expectSchema('Stats', stats.body);
    expect((snap.body.copies as unknown[]).length).toBe(2);

    await web.patch(`/works/${book.body.work.id}`, { baseVersion: 1, fields: { subtitle: 'Nivola' } });
    await web.del(`/editions/${other.body.editions[0].id}`);
    await web.del(`/quotes/${doomed.body.quotes.find((q: { text: string }) => q.text === 'Borrar').id}`);
    expect((await web.del(`/wishlist/${unwanted.body.id}`)).status).toBe(204);
    const page = await call(`/sync/pull?since=${snap.body.cursor}&epoch=${snap.body.epoch}`, { token });
    expectSchema('SyncPullPage', page.body);
    expect((page.body.deleted as unknown[]).length).toBeGreaterThan(0);

    // One result of each kind: applied, duplicate, conflict (the web changed the subtitle) and rejected.
    const created = {
      opId: uuidv7(),
      type: 'location.create',
      location: { parentId: home, name: 'Mesilla' },
    };
    const pushed = await call('/sync/push', {
      method: 'POST',
      token,
      payload: {
        epoch: snap.body.epoch,
        ops: [
          created,
          created,
          {
            opId: uuidv7(),
            type: 'work.update',
            id: book.body.work.id,
            patch: { baseVersion: 1, fields: { subtitle: 'Una nivola' } },
          },
          { opId: uuidv7(), type: 'copy.create', copy: { editionId: uuidv7() } },
        ],
      },
    });
    expectSchema('SyncPushResponse', pushed.body);
    expect((pushed.body.results as { status: string }[]).map((r) => r.status)).toEqual([
      'applied',
      'duplicate',
      'conflict',
      'rejected',
    ]);

    writeFixtures({
      'snapshot.json': snap.body,
      'stats.json': stats.body,
      'pull.json': page.body,
      'push.json': pushed.body,
    });

    bumpEpoch(db);
    const stale = await call(`/sync/pull?since=0&epoch=${snap.body.epoch}`, { token });
    expect(stale.status).toBe(409);
    expectSchema('Problem', stale.body);
    expectSchema('Problem', (await call('/auth/me')).body);
  });

  it('capture endpoints (ISBN lookup, cover upload and provider cover) match the spec', async () => {
    const jpeg = await sharp({ create: { width: 300, height: 450, channels: 3, background: '#8b3a2b' } })
      .jpeg()
      .toBuffer();
    const isbn = withCheckDigit('978843222147');
    const fakeProviders = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('openlibrary.org/api/books')) {
        return Response.json({
          [`ISBN:${isbn}`]: {
            title: 'La ridícula idea de no volver a verte',
            authors: [{ name: 'Rosa Montero' }],
            publishers: [{ name: 'Seix Barral' }],
            publish_date: '2013',
            number_of_pages: 240,
            cover: { large: 'https://covers.openlibrary.org/b/id/1-L.jpg' },
          },
        });
      }
      if (url.includes('openlibrary.org/search.json')) {
        return Response.json({
          numFound: 1,
          docs: [
            {
              key: '/works/OL26397010W',
              title: 'Existe la suerte',
              subtitle: 'Enganados por el azar',
              author_name: ['Nassim Nicholas Taleb'],
              first_publish_year: 2013,
              publisher: ['Paidós'],
              language: ['spa'],
              cover_i: 12344622,
              edition_key: ['OL35637692M'],
            },
          ],
        });
      }
      if (url.includes('googleapis.com/books')) {
        const q = new URL(url).searchParams.get('q') ?? '';
        if (q.startsWith('intitle:')) {
          return Response.json({
            items: [
              {
                volumeInfo: {
                  title: 'Existe la suerte',
                  authors: ['Nassim Nicholas Taleb'],
                  publisher: 'Paidós',
                  publishedDate: '2013',
                  language: 'es',
                  industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }],
                  imageLinks: {
                    thumbnail:
                      'http://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
                  },
                },
              },
            ],
          });
        }
      }
      if (url.startsWith('https://covers.openlibrary.org/')) {
        return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
      }
      return new Response('no', { status: 404 });
    }) as Fetch;
    const { app } = await makeApp({ fetch: fakeProviders });
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices',
      payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
    });
    const auth = { authorization: `Bearer ${reg.json().token}` };

    const lookup = await app.inject({ url: `/api/v1/lookup/isbn/${isbn}`, headers: auth });
    expect(lookup.json().found).toBe(true);
    expectSchema('LookupResult', lookup.json());
    const missing = await app.inject({
      url: `/api/v1/lookup/isbn/${withCheckDigit('978000000000')}`,
      headers: auth,
    });
    expectSchema('LookupResult', missing.json());

    const search = await app.inject({
      url: '/api/v1/lookup/search?title=existe%20la%20suerte&author=taleb',
      headers: auth,
    });
    expect(search.statusCode).toBe(200);
    expectSchema('MetadataSearchResult', search.json());

    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { ...auth, 'content-type': 'image/jpeg' },
      payload: jpeg,
    });
    expect(upload.statusCode).toBe(201);
    expectSchema('Asset', upload.json());
    const fetched = await app.inject({
      method: 'POST',
      url: '/api/v1/assets/fetch',
      headers: auth,
      payload: { url: 'https://covers.openlibrary.org/b/id/1-L.jpg' },
    });
    expect(fetched.statusCode).toBe(201);
    expectSchema('Asset', fetched.json());

    writeFixtures({
      'lookup.json': lookup.json(),
      'search.json': search.json(),
      'asset.json': upload.json(),
    });
  });

  it('the fixtures used by the Android tests match the spec', () => {
    for (const [file, schema] of Object.entries(FIXTURE_SCHEMAS)) {
      expectSchema(schema, JSON.parse(fs.readFileSync(`${FIXTURES}${file}`, 'utf8')));
    }
  });

  it('every path in the spec exists on the server', async () => {
    const { app } = await makeApp();
    for (const [p, ops] of Object.entries(spec.paths)) {
      const url = `/api/v1${p.replace('{id}', 'a'.repeat(64))}`;
      for (const method of Object.keys(ops)) {
        const r = await app.inject({ method: method.toUpperCase() as 'GET' | 'POST', url, payload: {} });
        // Unauthenticated or invalid is fine; "route does not exist" is not.
        expect(r.json().code, `${method.toUpperCase()} ${p}`).not.toBe('not-found');
      }
    }
  });
});
