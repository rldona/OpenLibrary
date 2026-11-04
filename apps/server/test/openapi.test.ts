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
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';
import { uuidv7 } from '@openlibrary/contracts';
import { bumpEpoch } from '../src/db/client.js';
import { makeApp, PASSWORD, webClient } from './helpers.js';

const SPEC_FILE = fileURLToPath(new URL('../../../packages/contracts/openapi.yaml', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../../packages/contracts/fixtures/', import.meta.url));
const FIXTURE_SCHEMAS = { 'snapshot.json': 'SyncSnapshot', 'pull.json': 'SyncPullPage' } as const;
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

    expectSchema('HealthResponse', (await call('/health')).body);

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
    expect((snap.body.copies as unknown[]).length).toBe(2);

    await web.patch(`/works/${book.body.work.id}`, { baseVersion: 1, fields: { subtitle: 'Nivola' } });
    await web.del(`/editions/${other.body.editions[0].id}`);
    const page = await call(`/sync/pull?since=${snap.body.cursor}&epoch=${snap.body.epoch}`, { token });
    expectSchema('SyncPullPage', page.body);
    expect((page.body.deleted as unknown[]).length).toBeGreaterThan(0);

    if (process.env.UPDATE_FIXTURES) {
      fs.mkdirSync(FIXTURES, { recursive: true });
      for (const [file, body] of [
        ['snapshot.json', snap.body],
        ['pull.json', page.body],
      ] as const) {
        fs.writeFileSync(`${FIXTURES}${file}`, JSON.stringify(body, null, 2) + '\n');
      }
    }

    bumpEpoch(db);
    const stale = await call(`/sync/pull?since=0&epoch=${snap.body.epoch}`, { token });
    expect(stale.status).toBe(409);
    expectSchema('Problem', stale.body);
    expectSchema('Problem', (await call('/auth/me')).body);
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
