import { describe, expect, it } from 'vitest';
import { uuidv7, withCheckDigit } from '@openlibrary/contracts';
import { makeApp, webClient } from './helpers.js';

const ISBN_1984 = withCheckDigit('978849989103');

async function setup() {
  const ctx = await makeApp();
  const c = await webClient(ctx.app);
  // Casa › Salón › Estantería › Balda 3 ; Casa › Despacho
  const mk = async (name: string, parentId: string | null, kind = 'other') => {
    const id = uuidv7();
    const r = await c.post('/locations', { id, parentId, name, kind });
    expect(r.status).toBe(201);
    return id;
  };
  const casa = await mk('Casa', null, 'home');
  const salon = await mk('Salón', casa, 'room');
  const estanteria = await mk('Estantería principal', salon, 'bookcase');
  const balda3 = await mk('Balda 3', estanteria, 'shelf');
  const despacho = await mk('Despacho', casa, 'room');
  return { ...ctx, c, loc: { casa, salon, estanteria, balda3, despacho } };
}

const book1984 = (locationId: string | null) => ({
  work: { title: '1984', authors: ['George Orwell'], subjects: ['Distopía', 'Ciencia ficción'] },
  edition: { publisher: 'Debolsillo', publishedYear: 2013, language: 'es', pages: 352, isbn13: ISBN_1984 },
  copy: { locationId, condition: 'used', acquiredOn: '2024-12-01', priceCents: 945 },
});

describe('criterios de aceptación F1', () => {
  it('alta manual SIN ISBN (libro antiguo)', async () => {
    const { c, loc } = await setup();
    const r = await c.post('/books', {
      work: { title: 'La Regenta', authors: ['Leopoldo Alas «Clarín»'] },
      edition: { publisher: 'Daniel Cortezo y Cía.', publishedYear: 1884, format: 'Tapa dura (2 tomos)' },
      copy: { locationId: loc.despacho, condition: 'poor', notes: 'Heredado del abuelo' },
    });
    expect(r.status).toBe(201);
    expect(r.body.editions[0]).toMatchObject({ isbn13: null, publishedYear: 1884 });
    expect(r.body.editions[0].copies[0]).toMatchObject({
      code: 'EJ-0001',
      locationPath: ['Casa', 'Despacho'],
    });
  });

  it('solo el título es obligatorio', async () => {
    const { c } = await setup();
    expect((await c.post('/books', { work: { title: '' }, edition: {}, copy: {} })).status).toBe(400);
    expect((await c.post('/books', { work: { title: 'Mínimo' }, edition: {}, copy: {} })).status).toBe(201);
  });

  it('ISBN: se normaliza (ISBN-10 o con guiones) y se rechaza si no es válido', async () => {
    const { c } = await setup();
    const ok = await c.post('/books', {
      work: { title: 'X' },
      edition: { isbn13: '84-9989-103-?'.replace('?', '') },
      copy: {},
    });
    expect(ok.status).toBe(400); // 9 dígitos: inválido
    const issn = await c.post('/books', {
      work: { title: 'Revista' },
      edition: { isbn13: '9770212345007' },
      copy: {},
    });
    expect(issn.status).toBe(400);
    expect(issn.body.detail).toContain('ISSN');
    const dashed = ISBN_1984.replace(/^(\d{3})(\d{2})(\d{4})(\d{3})(\d)$/, '$1-$2-$3-$4-$5');
    const r = await c.post('/books', { work: { title: '1984' }, edition: { isbn13: dashed }, copy: {} });
    expect(r.body.editions[0]).toMatchObject({
      isbn13: ISBN_1984,
      isbn10: expect.stringMatching(/^\d{9}[\dX]$/),
    });
  });

  it('varios ejemplares de una misma edición sin duplicar la edición', async () => {
    const { c, loc } = await setup();
    const first = await c.post('/books', book1984(loc.balda3));
    const editionId = first.body.created.editionId;

    // Volver a dar de alta el mismo ISBN se bloquea y se ofrece la edición existente.
    const dup = await c.post('/books', book1984(loc.despacho));
    expect(dup.status).toBe(409);
    expect(dup.body.existing).toMatchObject({ editionId, copies: 1 });

    const second = await c.post('/copies', { editionId, locationId: loc.despacho, notes: 'Regalo repetido' });
    expect(second.status).toBe(201);
    expect(second.body.editions).toHaveLength(1);
    expect(second.body.editions[0].copies.map((x: { code: string }) => x.code)).toEqual([
      'EJ-0001',
      'EJ-0002',
    ]);

    const lib = await c.get('/library');
    expect(lib.body.total).toBe(1);
    expect(lib.body.items[0].copies).toHaveLength(2);
  });

  it('localizar ejemplares por ubicación (incluye subdivisiones) y por texto de la ubicación', async () => {
    const { c, loc } = await setup();
    await c.post('/books', book1984(loc.balda3));
    await c.post('/books', {
      work: { title: 'Sapiens', authors: ['Yuval Noah Harari'] },
      edition: {},
      copy: { locationId: loc.despacho },
    });
    await c.post('/books', {
      work: { title: 'Kafka en la orilla' },
      edition: {},
      copy: { locationId: null },
    });

    const titles = async (qs: string) =>
      (await c.get(`/library?${qs}`)).body.items.map((i: { title: string }) => i.title);
    expect(await titles(`location=${loc.salon}`)).toEqual(['1984']);
    expect(await titles(`location=${loc.casa}&sort=title`)).toEqual(['1984', 'Sapiens']);
    expect(await titles('location=none')).toEqual(['Kafka en la orilla']);
    expect(await titles('q=balda%203')).toEqual(['1984']);
  });
});

describe('búsqueda, filtros y orden', () => {
  it('busca por título, autor sin tildes, ISBN, editorial y género', async () => {
    const { c, loc } = await setup();
    await c.post('/books', book1984(loc.balda3));
    await c.post('/books', {
      work: {
        title: 'Cien años de soledad',
        authors: ['Gabriel García Márquez'],
        subjects: ['Realismo mágico'],
      },
      edition: { publisher: 'Debolsillo', language: 'es' },
      copy: { locationId: loc.balda3, acquiredOn: '2025-03-12' },
    });
    const q = async (s: string) =>
      (await c.get(`/library?q=${encodeURIComponent(s)}`)).body.items
        .map((i: { title: string }) => i.title)
        .sort();
    expect(await q('garcia marq')).toEqual(['Cien años de soledad']);
    expect(await q('ORWELL')).toEqual(['1984']);
    expect(await q(ISBN_1984)).toEqual(['1984']);
    expect(await q('debolsillo')).toEqual(['1984', 'Cien años de soledad']);
    expect(await q('realismo')).toEqual(['Cien años de soledad']);
    expect(await q('"; DROP TABLE works; --')).toEqual([]);
  });

  it('filtra por género e idioma, y ordena por autor y por fecha de adquisición', async () => {
    const { c, loc } = await setup();
    await c.post('/books', book1984(loc.balda3));
    await c.post('/books', {
      work: { title: 'Ficciones', authors: ['Jorge Luis Borges'], subjects: ['Relato'] },
      edition: { language: 'es' },
      copy: { acquiredOn: '2025-02-02' },
    });
    await c.post('/books', {
      work: { title: 'Animal Farm', authors: ['George Orwell'], subjects: ['Distopía'] },
      edition: { language: 'en' },
      copy: { acquiredOn: '2026-01-01' },
    });
    const t = async (qs: string) =>
      (await c.get(`/library?${qs}`)).body.items.map((i: { title: string }) => i.title);
    expect(await t('subject=Distop%C3%ADa')).toEqual(['1984', 'Animal Farm']);
    expect(await t('language=en')).toEqual(['Animal Farm']);
    expect(await t('sort=author')).toEqual(['Ficciones', '1984', 'Animal Farm']);
    expect(await t('sort=acquired')).toEqual(['Animal Farm', 'Ficciones', '1984']);
    const facets = (await c.get('/library/facets')).body;
    expect(facets.subjects[0]).toEqual({ name: 'Distopía', count: 2 });
    expect(facets.languages).toEqual(['en', 'es']);
  });

  it('pagina con limit/offset y devuelve el total', async () => {
    const { c } = await setup();
    for (let i = 0; i < 5; i++)
      await c.post('/books', { work: { title: `Libro ${i}` }, edition: {}, copy: {} });
    const p = await c.get('/library?limit=2&offset=2');
    expect(p.body.total).toBe(5);
    expect(p.body.items.map((i: { title: string }) => i.title)).toEqual(['Libro 2', 'Libro 3']);
  });
});

describe('modificaciones con versión y fusión por campo', () => {
  it('cambios en campos distintos se fusionan; en el mismo campo, conflicto sin sobrescribir', async () => {
    const { c, loc } = await setup();
    const r = await c.post('/books', book1984(loc.balda3));
    const copy = r.body.editions[0].copies[0];
    const v1 = copy.version;

    // «Web» mueve el ejemplar con la versión 1.
    const a = await c.patch(`/copies/${copy.id}`, { baseVersion: v1, fields: { locationId: loc.despacho } });
    expect(a.status).toBe(200);
    // «Móvil» (que aún tenía la versión 1) cambia las notas → se fusiona.
    const b = await c.patch(`/copies/${copy.id}`, { baseVersion: v1, fields: { notes: 'Subrayado' } });
    expect(b.status).toBe(200);
    expect(b.body.editions[0].copies[0]).toMatchObject({
      locationPath: ['Casa', 'Despacho'],
      notes: 'Subrayado',
      version: 3,
    });
    // «Móvil» con versión 1 intenta cambiar la ubicación a otro sitio → conflicto.
    const conflict = await c.patch(`/copies/${copy.id}`, {
      baseVersion: v1,
      fields: { locationId: loc.salon },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.conflicts[0]).toMatchObject({
      field: 'locationId',
      current: loc.despacho,
      yours: loc.salon,
    });
    // Mismo valor que el actual: convergente, sin conflicto.
    const same = await c.patch(`/copies/${copy.id}`, {
      baseVersion: v1,
      fields: { locationId: loc.despacho },
    });
    expect(same.status).toBe(200);
  });

  it('editar la obra reindexa la búsqueda y el orden', async () => {
    const { c } = await setup();
    const r = await c.post('/books', { work: { title: 'Titulo provisional' }, edition: {}, copy: {} });
    const w = r.body.work;
    await c.patch(`/works/${w.id}`, {
      baseVersion: w.version,
      fields: { title: 'Ábaco', authors: ['Ana Zubiri'] },
    });
    expect((await c.get('/library?q=abaco')).body.total).toBe(1);
    expect((await c.get('/library?q=provisional')).body.total).toBe(0);
  });

  it('retirar un ejemplar lo saca de la colección pero conserva el registro', async () => {
    const { c, loc } = await setup();
    const r = await c.post('/books', book1984(loc.balda3));
    const copy = r.body.editions[0].copies[0];
    const ret = await c.patch(`/copies/${copy.id}`, {
      baseVersion: copy.version,
      fields: { status: 'retired', retiredReason: 'gifted' },
    });
    expect(ret.body.editions[0].copies[0]).toMatchObject({
      status: 'retired',
      retiredReason: 'gifted',
      retiredOn: '2026-11-04',
    });
    expect((await c.get('/library')).body.total).toBe(0);
    expect(
      (await c.get('/locations')).body.items.find((l: { id: string }) => l.id === loc.balda3).copyCount,
    ).toBe(0);
  });

  it('nueva edición de una obra existente', async () => {
    const { c, loc } = await setup();
    const r = await c.post('/books', book1984(loc.balda3));
    const en = await c.post('/books', {
      workId: r.body.work.id,
      edition: { publisher: 'Penguin', language: 'en', isbn13: withCheckDigit('978014103614') },
      copy: {},
    });
    expect(en.body.editions).toHaveLength(2);
    const lib = await c.get('/library');
    expect(lib.body.items.every((i: { editionCount: number }) => i.editionCount === 2)).toBe(true);
  });

  it('borrar la única edición borra también la obra (lápida)', async () => {
    const { c } = await setup();
    const r = await c.post('/books', { work: { title: 'Error' }, edition: {}, copy: {} });
    const d = await c.del(`/editions/${r.body.created.editionId}`);
    expect(d.body).toEqual({ workDeleted: true });
    expect((await c.get(`/works/${r.body.work.id}`)).status).toBe(404);
  });
});

describe('ubicaciones', () => {
  it('árbol con conteos acumulados y ejemplares sin ubicación', async () => {
    const { c, loc } = await setup();
    await c.post('/books', book1984(loc.balda3));
    await c.post('/books', { work: { title: 'Suelto' }, edition: {}, copy: {} });
    const t = (await c.get('/locations')).body;
    const byId = (id: string) => t.items.find((l: { id: string }) => l.id === id);
    expect(byId(loc.casa)).toMatchObject({ copyCount: 1, directCount: 0 });
    expect(byId(loc.balda3)).toMatchObject({ copyCount: 1, directCount: 1 });
    expect(t.unassigned).toBe(1);
  });

  it('renombrar reindexa la búsqueda; mover dentro de sí misma se rechaza', async () => {
    const { c, loc } = await setup();
    await c.post('/books', book1984(loc.balda3));
    const t = (await c.get('/locations')).body;
    const salon = t.items.find((l: { id: string }) => l.id === loc.salon);
    await c.patch(`/locations/${loc.salon}`, {
      baseVersion: salon.version,
      fields: { name: 'Sala de estar' },
    });
    expect((await c.get('/library?q=sala%20estar')).body.total).toBe(1);
    const casa = t.items.find((l: { id: string }) => l.id === loc.casa);
    const cyc = await c.patch(`/locations/${loc.casa}`, {
      baseVersion: casa.version,
      fields: { parentId: loc.balda3 },
    });
    expect(cyc.status).toBe(400);
  });

  it('no se borra una ubicación con ejemplares o subdivisiones', async () => {
    const { c, loc } = await setup();
    await c.post('/books', book1984(loc.balda3));
    expect((await c.del(`/locations/${loc.balda3}`)).status).toBe(409);
    expect((await c.del(`/locations/${loc.salon}`)).status).toBe(409);
    expect((await c.del(`/locations/${loc.despacho}`)).status).toBe(200);
  });
});

describe('seguridad del catálogo', () => {
  it('todo requiere sesión', async () => {
    const { app } = await setup();
    for (const url of ['/api/v1/library', '/api/v1/locations', `/api/v1/lookup/isbn/${ISBN_1984}`]) {
      expect((await app.inject(url)).statusCode).toBe(401);
    }
  });
});
