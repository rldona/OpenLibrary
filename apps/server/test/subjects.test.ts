import { describe, expect, it } from 'vitest';
import { withCheckDigit } from '@openlibrary/contracts';
import { makeApp, ORIGIN, webClient } from './helpers.js';
import type { Fetch } from '../src/lookup/providers.js';
import { translateSubjects } from '../src/lookup/subjects.js';
import { retranslateSubjects } from '../src/lookup/retranslate.js';
import { CatalogService } from '../src/catalog/service.js';

const ISBN = withCheckDigit('978849759123');

describe('subject translation', () => {
  it('translates known subjects into Spanish and keeps unknown ones', () => {
    expect(
      translateSubjects(
        ['Women', 'Sex', 'Feminism', 'Sexual Behavior', 'Non-Fiction', 'Duelo', 'Zizekiana'],
        'es',
      ),
    ).toEqual(['Mujeres', 'Sexo', 'Feminismo', 'Conducta sexual', 'No ficción', 'Duelo', 'Zizekiana']);
  });

  it('ignores case, spacing and curly apostrophes', () => {
    expect(translateSubjects(['  philosophy ', 'NONFICTION', 'Children’s literature'], 'es')).toEqual([
      'Filosofía',
      'No ficción',
      'Literatura infantil',
    ]);
  });

  it('translates Google Books headings part by part', () => {
    expect(translateSubjects(['Fiction / Science Fiction / General', 'Philosophy / Zen'], 'es')).toEqual([
      'Ficción / Ciencia ficción / General',
      'Filosofía / Zen',
    ]);
  });

  it('drops the duplicates the translation creates', () => {
    expect(translateSubjects(['Nonfiction', 'Non-Fiction', 'No ficción', 'Memoirs', 'Memoir'], 'es')).toEqual(
      ['No ficción', 'Memorias'],
    );
  });

  it('leaves English as it is', () => {
    expect(translateSubjects(['Philosophy', 'Non-Fiction'], 'en')).toEqual(['Philosophy', 'Non-Fiction']);
  });
});

describe('ISBN lookup in Spanish', () => {
  const providers: Fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url.includes('openlibrary.org/api/books')
      ? {
          [`ISBN:${ISBN}`]: {
            title: 'El segundo sexo',
            authors: [{ name: 'Simone de Beauvoir' }],
            subjects: [{ name: 'Women' }, { name: 'Feminism' }],
          },
        }
      : { items: [{ volumeInfo: { title: 'El segundo sexo', categories: ['Philosophy'] } }] };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as Fetch;

  it('answers each client in its language from the same cached lookup', async () => {
    const { app } = await makeApp({ fetch: providers });
    const { token } = await webClient(app);
    const get = async (lang: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/lookup/isbn/${ISBN}`,
          headers: { origin: ORIGIN, 'accept-language': lang },
          cookies: { ol_session: token },
        })
      ).json().proposal.subjects;
    expect(await get('es-ES,es;q=0.9')).toEqual(['Mujeres', 'Feminismo']);
    expect(await get('en')).toEqual(['Women', 'Feminism']);
  });
});

describe('translate-subjects for the books already saved', () => {
  it('is a dry run unless asked, then saves a new version of each changed work', async () => {
    const { app, db } = await makeApp();
    const c = await webClient(app);
    const en = await c.post('/books', {
      work: { title: 'El segundo sexo', subjects: ['Women', 'Non-Fiction'] },
      edition: {},
      copy: { locationId: null },
    });
    const es = await c.post('/books', {
      work: { title: '1984', subjects: ['Distopía'] },
      edition: {},
      copy: { locationId: null },
    });
    expect(en.status).toBe(201);
    const catalog = new CatalogService(db);

    const dry = retranslateSubjects(db, catalog, 'es', false);
    expect(dry).toEqual([
      {
        workId: en.body.work.id,
        title: 'El segundo sexo',
        before: ['Women', 'Non-Fiction'],
        after: ['Mujeres', 'No ficción'],
      },
    ]);
    expect((await c.get(`/works/${en.body.work.id}`)).body.work.subjects).toEqual(['Women', 'Non-Fiction']);

    expect(retranslateSubjects(db, catalog, 'es', true)).toHaveLength(1);
    const after = (await c.get(`/works/${en.body.work.id}`)).body.work;
    expect(after.subjects).toEqual(['Mujeres', 'No ficción']);
    expect(after.version).toBe(en.body.work.version + 1);
    expect((await c.get(`/works/${es.body.work.id}`)).body.work.version).toBe(es.body.work.version);
    expect(retranslateSubjects(db, catalog, 'es', true)).toEqual([]);
  });
});
