/**
 * F5 criteria: export → clean install → import gives the same counts and relations; the import reports
 * duplicates and invalid rows; the dry run changes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { uuidv7, withCheckDigit } from '@openlibrary/contracts';
import { makeApp, ORIGIN, PASSWORD, webClient } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof makeApp>>;
type Client = Awaited<ReturnType<typeof webClient>>;

const ISBN = withCheckDigit('978843760494');
const ISBN2 = withCheckDigit('978849759234');

async function setup() {
  const ctx = await makeApp();
  return { ...ctx, c: await webClient(ctx.app) };
}

/** A small library with every kind of record, a cover and a nested location. */
async function library({ app, c }: Ctx & { c: Client }) {
  const jpeg = await sharp({ create: { width: 300, height: 450, channels: 3, background: '#8b3a2b' } })
    .jpeg()
    .toBuffer();
  const cover = await app.inject({
    method: 'POST',
    url: '/api/v1/assets',
    headers: { origin: ORIGIN, 'content-type': 'image/jpeg' },
    cookies: { ol_session: c.token },
    payload: jpeg,
  });
  const home = uuidv7();
  const shelf = uuidv7();
  await c.post('/locations', { id: home, parentId: null, name: 'Casa', kind: 'home' });
  await c.post('/locations', { id: shelf, parentId: home, name: 'Balda 2', kind: 'shelf' });
  const niebla = (
    await c.post('/books', {
      work: { title: 'Niebla', authors: ['Miguel de Unamuno'], subjects: ['Novela'] },
      edition: { isbn13: ISBN, publisher: 'Cátedra', pages: 300, coverAssetId: cover.json().id },
      copy: {
        locationId: shelf,
        priceCents: 1250,
        acquiredOn: '2024-03-01',
        notes: 'Con "comillas", y comas',
      },
    })
  ).body;
  const copyId = niebla.created.copyId as string;
  await c.post('/copies', { editionId: niebla.created.editionId, condition: 'used' });
  const dune = (
    await c.post('/books', { work: { title: 'Dune', authors: ['Frank Herbert'] }, edition: {}, copy: {} })
  ).body;
  await c.patch(`/copies/${dune.created.copyId}`, {
    baseVersion: 1,
    fields: { status: 'retired', retiredReason: 'gifted' },
  });
  await c.post('/reading-sessions', { copyId, status: 'read', finishedOn: '2025-01-10', rating: 4.5 });
  await c.post('/quotes', { workId: niebla.work.id, text: 'Página 12', page: 12, copyId });
  await c.post('/wishlist', { title: 'San Manuel Bueno, mártir', workId: niebla.work.id, priority: 'high' });
  return { copyId, workId: niebla.work.id as string };
}

const get = (app: Ctx['app'], c: Client, url: string) =>
  app.inject({ url: `/api/v1${url}`, cookies: { ol_session: c.token } });

const importFile = (app: Ctx['app'], c: Client, body: Buffer | string, dryRun: boolean, lang = 'en') =>
  app.inject({
    method: 'POST',
    url: `/api/v1/import?dryRun=${dryRun}`,
    headers: { origin: ORIGIN, 'content-type': 'application/octet-stream', 'accept-language': lang },
    cookies: { ol_session: c.token },
    payload: Buffer.isBuffer(body) ? body : Buffer.from(body),
  });

/** What a device would see, without this installation's bookkeeping (versions). */
async function snapshotOf(ctx: Ctx) {
  const reg = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/devices',
    payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
  });
  const snap = (
    await ctx.app.inject({
      url: '/api/v1/sync/snapshot',
      headers: { authorization: `Bearer ${reg.json().token}` },
    })
  ).json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clean = (rows: { version: number }[]) => rows.map(({ version: _v, ...r }) => r as any);
  return {
    works: clean(snap.works),
    editions: clean(snap.editions),
    copies: clean(snap.copies),
    locations: clean(snap.locations),
    readings: clean(snap.readings),
    quotes: clean(snap.quotes),
    wishes: clean(snap.wishes),
  };
}

describe('export', () => {
  it('the zip holds library.json and the covers', async () => {
    const ctx = await setup();
    await library(ctx);
    const r = await get(ctx.app, ctx.c, '/export/full');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/zip');
    expect(r.headers['content-disposition']).toBe('attachment; filename="openlibrary-2026-11-04.zip"');
    const files = unzipSync(r.rawPayload);
    const lib = JSON.parse(Buffer.from(files['library.json']!).toString());
    expect(lib).toMatchObject({ format: 'openlibrary', format_version: 1 });
    expect(lib.works).toHaveLength(2);
    expect(lib.copies).toHaveLength(3);
    expect(lib.assets).toHaveLength(1);
    expect(lib.works[0]).not.toHaveProperty('sortTitle');
    expect(lib.works[0]).not.toHaveProperty('version');
    expect(Object.keys(files).filter((f) => f.startsWith('assets/'))).toEqual([
      `assets/${lib.assets[0].id}.jpg`,
    ]);
  });

  it('the CSV has one row per copy, quoted where needed, with a BOM', async () => {
    const ctx = await setup();
    await library(ctx);
    const r = await get(ctx.app, ctx.c, '/export/csv');
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    const text = r.body;
    expect(text.startsWith('﻿code,title,subtitle,authors,isbn13')).toBe(true);
    const lines = text.trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(`EJ-0001,Niebla,,Miguel de Unamuno,${ISBN},Cátedra`);
    expect(lines[1]).toContain(
      'Casa / Balda 2,good,2024-03-01,12.50,EUR,active,,"Con ""comillas"", y comas",read,4.5',
    );
    expect(lines[3]).toContain('retired,gifted');
  });

  it('requires a session', async () => {
    const { app } = await makeApp();
    for (const url of ['/export/full', '/export/csv', '/export/json', '/backups/status']) {
      expect((await app.inject({ url: `/api/v1${url}` })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/v1/import' })).statusCode).toBe(401);
  });
});

describe('import', () => {
  it('F5 acceptance: export → clean install → import gives the same library', async () => {
    const source = await setup();
    await library(source);
    const zip = (await get(source.app, source.c, '/export/full')).rawPayload;

    const target = await setup();
    const dry = (await importFile(target.app, target.c, zip, true)).json();
    expect(dry).toMatchObject({ dryRun: true, source: 'zip', issuesTotal: 0 });
    expect(dry.counts).toEqual({
      works: { created: 2, duplicates: 0, invalid: 0 },
      editions: { created: 2, duplicates: 0, invalid: 0 },
      copies: { created: 3, duplicates: 0, invalid: 0 },
      locations: { created: 2, duplicates: 0, invalid: 0 },
      readings: { created: 1, duplicates: 0, invalid: 0 },
      quotes: { created: 1, duplicates: 0, invalid: 0 },
      wishes: { created: 1, duplicates: 0, invalid: 0 },
      assets: { created: 1, duplicates: 0, invalid: 0 },
    });
    // The dry run changed nothing, not even the covers folder.
    expect((await target.c.get('/library')).body.total).toBe(0);
    expect(fs.existsSync(path.join(target.dataDir, 'assets'))).toBe(false);

    const real = (await importFile(target.app, target.c, zip, false)).json();
    expect(real.counts).toEqual(dry.counts);
    expect(await snapshotOf(target)).toEqual(await snapshotOf(source));
    expect((await target.c.get('/stats')).body).toEqual((await source.c.get('/stats')).body);

    // Search works on the imported data, the cover is served and new copies continue the code sequence.
    expect((await target.c.get('/library?q=unamuno')).body.total).toBe(1);
    const work = (await target.c.get('/library?q=niebla')).body.items[0];
    const coverId = work.coverAssetId ?? work.edition?.coverAssetId;
    const ed = (await target.c.get(`/works/${work.workId ?? work.id}`)).body.editions[0];
    expect((await get(target.app, target.c, `/assets/${ed.coverAssetId ?? coverId}`)).statusCode).toBe(200);
    const more = await target.c.post('/copies', { editionId: ed.id });
    expect(more.body.editions[0].copies.map((x: { code: string }) => x.code)).toContain('EJ-0004');
  });

  it('importing the same file again only reports duplicates', async () => {
    const ctx = await setup();
    await library(ctx);
    const zip = (await get(ctx.app, ctx.c, '/export/full')).rawPayload;
    const r = (await importFile(ctx.app, ctx.c, zip, false)).json();
    for (const counts of Object.values(r.counts) as { created: number }[]) expect(counts.created).toBe(0);
    expect(r.counts.copies.duplicates).toBe(3);
    expect(r.counts.assets.duplicates).toBe(1);
    expect(r.issues.every((i: { kind: string }) => i.kind === 'duplicate')).toBe(true);
  });

  it('reports duplicates and invalid rows, and imports the rest', async () => {
    const ctx = await setup();
    const own = (await ctx.c.post('/books', { work: { title: 'Mía' }, edition: { isbn13: ISBN }, copy: {} }))
      .body;
    const [w1, w2, w3, e1, e2, e3, e4, c1, c2, c3] = Array.from({ length: 10 }, () => uuidv7()) as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const ts = '2024-01-01T00:00:00.000Z';
    const meta = { createdAt: ts, updatedAt: ts };
    const file = {
      format: 'openlibrary',
      format_version: 1,
      works: [
        { id: w1, title: 'Nueva', ...meta },
        { id: w2, title: 'Mía (otra vez)', ...meta },
        { id: w3, title: '', ...meta },
        { id: own.work.id, title: 'Mía', ...meta },
      ],
      editions: [
        { id: e1, workId: w1, isbn13: ISBN2, ...meta },
        { id: e2, workId: w2, isbn13: ISBN, ...meta },
        { id: e3, workId: uuidv7(), ...meta },
        { id: e4, workId: w1, isbn13: '9771234567003', ...meta },
      ],
      copies: [
        { id: c1, editionId: e1, code: 'EJ-0001', locationId: uuidv7(), ...meta },
        { id: c2, editionId: e2, code: 'EJ-0007', ...meta },
        { id: c3, editionId: e3, code: 'EJ-0008', ...meta },
        { id: uuidv7(), editionId: e1, code: 'EJ-0009', priceCents: -5, ...meta },
      ],
      quotes: [{ id: uuidv7(), workId: w2, text: 'Va a la obra existente', ...meta }],
    };
    const r = (await importFile(ctx.app, ctx.c, JSON.stringify(file), false, 'es')).json();
    expect(r.source).toBe('json');
    expect(r.counts.works).toEqual({ created: 1, duplicates: 2, invalid: 1 });
    expect(r.counts.editions).toEqual({ created: 1, duplicates: 1, invalid: 2 });
    expect(r.counts.copies).toEqual({ created: 2, duplicates: 0, invalid: 2 });
    expect(r.counts.quotes.created).toBe(1);
    const msg = (kind: string, id: string) =>
      r.issues.find((i: { kind: string; id: string }) => i.kind === kind && i.id === id)?.message;
    expect(msg('invalid', w3)).toContain('El título es obligatorio.');
    expect(msg('duplicate', e2)).toContain(`Ya hay una edición con ISBN ${ISBN}`);
    expect(msg('invalid', e3)).toBe('Su obra no está ni en el archivo ni en la biblioteca.');
    expect(msg('invalid', e4)).toContain('ISSN');
    expect(msg('warning', c1)).toBe('Falta su ubicación: se importa sin ubicación.');
    expect(
      r.issues.find(
        (i: { kind: string; id: string; message: string }) =>
          i.kind === 'warning' && i.id === c1 && /código/.test(i.message),
      )?.message,
    ).toBe('El código EJ-0001 ya está en uso: se le asigna EJ-0010.');
    expect(msg('invalid', c3)).toBe('Su edición no está ni en el archivo ni en la biblioteca.');

    // The copy of the duplicate ISBN and the quote went to the existing book.
    const mine = (await ctx.c.get(`/works/${own.work.id}`)).body;
    expect(mine.editions[0].copies.map((x: { code: string }) => x.code)).toEqual(['EJ-0001', 'EJ-0007']);
    expect(mine.quotes.map((q: { text: string }) => q.text)).toEqual(['Va a la obra existente']);
  });

  it('rejects files that are not ours', async () => {
    const { app, c } = await setup();
    const bad = async (body: string | Buffer) => (await importFile(app, c, body, true)).json();
    expect(await bad('')).toMatchObject({ status: 400, code: 'bad-request' });
    expect((await bad('{"format":"other","format_version":1}')).detail).toContain(
      'This is not an OpenLibrary export.',
    );
    expect((await bad('{"format":"openlibrary","format_version":99}')).detail).toContain('newer version');
    expect((await bad('{not json')).detail).toContain('cannot be read');
    expect((await bad(Buffer.from('PK\u0003\u0004 broken'))).detail).toContain('cannot be read');
    expect((await bad('name,author\nX,Y\n')).detail).toContain('"title"');
  });

  it('CSV: export → clean install → import keeps books, copies, locations and readings', async () => {
    const source = await setup();
    await library(source);
    const csv = (await get(source.app, source.c, '/export/csv')).body;
    const target = await setup();
    const r = (await importFile(target.app, target.c, csv, false)).json();
    expect(r.source).toBe('csv');
    expect(r.issuesTotal).toBe(0);
    expect(r.counts).toMatchObject({
      works: { created: 2 },
      editions: { created: 2 },
      copies: { created: 3 },
      locations: { created: 2 },
      readings: { created: 1 },
    });
    const a = await snapshotOf(source);
    const b = await snapshotOf(target);
    const pick = (s: typeof a) =>
      s.copies
        .map((c) => [c.code, c.id, c.status, c.retiredReason, c.priceCents, c.notes, c.editionId])
        .sort();
    expect(pick(b)).toEqual(pick(a));
    expect(b.locations.map((l) => l.name).sort()).toEqual(['Balda 2', 'Casa']);
    // Importing it again: every row is a duplicate.
    const again = (await importFile(target.app, target.c, csv, false)).json();
    expect(again.counts.copies).toEqual({ created: 0, duplicates: 3, invalid: 0 });
  });

  it('CSV from a spreadsheet: ";" separator, decimal comma, no ids, bad rows reported by line', async () => {
    const { app, c } = await setup();
    await c.post('/books', {
      work: { title: 'Niebla', authors: ['Miguel de Unamuno'] },
      edition: {},
      copy: {},
    });
    const csv = [
      'Title;Authors;ISBN13;Price;Location;Pages',
      `La Regenta;Leopoldo Alas;${ISBN};12,95;Salón / Estantería;`,
      `La Regenta;Leopoldo Alas;${ISBN};;Salón / Estantería;`,
      'Niebla;Miguel de Unamuno;;;;',
      ';Nadie;;;;',
      'Sin páginas;;;;;muchas',
    ].join('\n');
    const r = (await importFile(app, c, csv, false)).json();
    expect(r.counts.works.created).toBe(1);
    expect(r.counts.editions.created).toBe(1);
    expect(r.counts.locations.created).toBe(2);
    // Line 3 is the same ISBN in the same file: a second copy. Line 4 already exists. 5 and 6 are invalid.
    expect(r.counts.copies).toEqual({ created: 2, duplicates: 1, invalid: 2 });
    expect(r.issues.map((i: { row: number; kind: string }) => [i.row, i.kind])).toEqual([
      [4, 'duplicate'],
      [5, 'invalid'],
      [6, 'invalid'],
    ]);
    const lib = (await c.get('/library?q=regenta')).body.items[0];
    expect(lib.copies).toHaveLength(2);
  });

  it('devices receive imported records in their next pull', async () => {
    const source = await setup();
    await library(source);
    const zip = (await get(source.app, source.c, '/export/full')).rawPayload;
    const target = await setup();
    const reg = await target.app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices',
      payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
    });
    const auth = { authorization: `Bearer ${reg.json().token}` };
    const snap = (await target.app.inject({ url: '/api/v1/sync/snapshot', headers: auth })).json();
    await importFile(target.app, target.c, zip, false);
    const page = (
      await target.app.inject({
        url: `/api/v1/sync/pull?since=${snap.cursor}&epoch=${snap.epoch}`,
        headers: auth,
      })
    ).json();
    expect(page.copies).toHaveLength(3);
    expect(page.quotes).toHaveLength(1);
  });
});

describe('backup status', () => {
  it('reads the mark left by backup.sh and warns when it is old', async () => {
    const { c, dataDir, advance } = await setup();
    expect((await c.get('/backups/status')).body).toEqual({ lastSuccessAt: null, stale: true });
    fs.mkdirSync(path.join(dataDir, 'backups'));
    fs.writeFileSync(path.join(dataDir, 'backups', 'last-success'), '2026-11-04T03:00:00Z\n');
    expect((await c.get('/backups/status')).body).toEqual({
      lastSuccessAt: '2026-11-04T03:00:00.000Z',
      stale: false,
    });
    advance(4 * 86_400_000);
    expect((await c.get('/backups/status')).body.stale).toBe(true);
  });
});
