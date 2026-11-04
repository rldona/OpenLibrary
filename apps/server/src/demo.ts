/**
 * Sample data to try the app (only on an empty library). The ISBNs are made up.
 * Book data is real-world (titles, authors); location names follow the given language.
 */
import { BookCreate, LocationCreate, withCheckDigit, type Lang } from '@openlibrary/contracts';
import type { CatalogService } from './catalog/service.js';

type Loc = [
  key: string,
  name: { en: string; es: string },
  parent: string | null,
  kind: 'home' | 'room' | 'bookcase' | 'shelf' | 'box' | 'other',
];
const LOCATIONS: Loc[] = [
  ['casa', { en: 'Home', es: 'Casa' }, null, 'home'],
  ['salon', { en: 'Living room', es: 'Salón' }, 'casa', 'room'],
  ['est', { en: 'Main bookcase', es: 'Estantería principal' }, 'salon', 'bookcase'],
  ['b1', { en: 'Shelf 1', es: 'Balda 1' }, 'est', 'shelf'],
  ['b2', { en: 'Shelf 2', es: 'Balda 2' }, 'est', 'shelf'],
  ['b3', { en: 'Shelf 3', es: 'Balda 3' }, 'est', 'shelf'],
  ['tv', { en: 'TV unit', es: 'Mueble TV' }, 'salon', 'bookcase'],
  ['despacho', { en: 'Study', es: 'Despacho' }, 'casa', 'room'],
  ['ikea', { en: 'IKEA bookcase', es: 'Estantería IKEA' }, 'despacho', 'bookcase'],
  ['sup', { en: 'Top shelf', es: 'Balda superior' }, 'ikea', 'shelf'],
  ['inf', { en: 'Bottom shelf', es: 'Balda inferior' }, 'ikea', 'shelf'],
  ['dormitorio', { en: 'Bedroom', es: 'Dormitorio' }, 'casa', 'room'],
  ['mesilla', { en: 'Bedside table', es: 'Mesilla' }, 'dormitorio', 'other'],
  ['trastero', { en: 'Storage room', es: 'Trastero' }, 'casa', 'room'],
  ['caja', { en: 'Box "Classics"', es: 'Caja «Clásicos»' }, 'trastero', 'box'],
];

type Demo = {
  t: string;
  a: string[];
  g: string[];
  pub?: string;
  y?: number;
  l?: string;
  p?: number;
  isbn?: string;
  loc: string | null;
  cond?: string;
  acq?: string;
  notes?: { en: string; es: string };
  extra?: string[];
};
const BOOKS: Demo[] = [
  {
    t: 'Cien años de soledad',
    a: ['Gabriel García Márquez'],
    g: ['Novela', 'Realismo mágico'],
    pub: 'Debolsillo',
    y: 2014,
    l: 'es',
    p: 496,
    isbn: '978849759246',
    loc: 'b3',
    acq: '2025-03-12',
  },
  {
    t: 'Don Quijote de la Mancha',
    a: ['Miguel de Cervantes'],
    g: ['Clásicos', 'Novela'],
    pub: 'Alfaguara',
    y: 2015,
    l: 'es',
    p: 1376,
    isbn: '978842041828',
    loc: 'b1',
    cond: 'fine',
    acq: '2024-12-20',
  },
  {
    t: 'La sombra del viento',
    a: ['Carlos Ruiz Zafón'],
    g: ['Novela', 'Misterio'],
    pub: 'Planeta',
    y: 2001,
    l: 'es',
    p: 576,
    isbn: '978840809472',
    loc: 'b2',
    acq: '2025-07-01',
  },
  {
    t: 'Rayuela',
    a: ['Julio Cortázar'],
    g: ['Novela'],
    pub: 'Cátedra',
    y: 2008,
    l: 'es',
    p: 736,
    isbn: '978843760474',
    loc: 'b3',
    acq: '2026-09-14',
  },
  {
    t: 'Ficciones',
    a: ['Jorge Luis Borges'],
    g: ['Relato', 'Clásicos'],
    pub: 'Debolsillo',
    y: 2011,
    l: 'es',
    p: 224,
    isbn: '978849989050',
    loc: 'b1',
    acq: '2025-02-02',
  },
  {
    t: '1984',
    a: ['George Orwell'],
    g: ['Distopía', 'Ciencia ficción'],
    pub: 'Debolsillo',
    y: 2013,
    l: 'es',
    p: 352,
    isbn: '978849989103',
    loc: 'b2',
    cond: 'used',
    acq: '2024-12-01',
    extra: ['mesilla'],
  },
  {
    t: 'Dune',
    a: ['Frank Herbert'],
    g: ['Ciencia ficción'],
    pub: 'Debolsillo',
    y: 2019,
    l: 'es',
    p: 784,
    isbn: '978846634235',
    loc: 'sup',
    acq: '2026-10-02',
  },
  {
    t: 'Sapiens',
    a: ['Yuval Noah Harari'],
    g: ['Ensayo', 'Historia'],
    pub: 'Debate',
    y: 2015,
    l: 'es',
    p: 496,
    isbn: '978849992622',
    loc: 'despacho',
    acq: '2025-05-18',
  },
  {
    t: 'El Hobbit',
    a: ['J. R. R. Tolkien'],
    g: ['Fantasía'],
    pub: 'Minotauro',
    y: 2012,
    l: 'es',
    p: 320,
    isbn: '978844500048',
    loc: 'inf',
    cond: 'used',
    acq: '2025-10-30',
    notes: { en: 'Bought at the Cuesta de Moyano book stalls.', es: 'Comprado en la Cuesta de Moyano.' },
  },
  {
    t: 'Clean Code',
    a: ['Robert C. Martin'],
    g: ['Informática'],
    pub: 'Prentice Hall',
    y: 2008,
    l: 'en',
    p: 464,
    isbn: '978013235088',
    loc: 'despacho',
    cond: 'used',
    acq: '2026-08-08',
  },
  {
    t: 'La Regenta',
    a: ['Leopoldo Alas «Clarín»'],
    g: ['Clásicos', 'Novela'],
    pub: 'Daniel Cortezo y Cía.',
    y: 1884,
    l: 'es',
    p: 1080,
    loc: 'caja',
    cond: 'poor',
    acq: '2010-06-01',
    notes: {
      en: 'Inherited from grandpa. Loose spine on volume II.',
      es: 'Heredado del abuelo. Lomo despegado en el tomo II.',
    },
  },
  {
    t: 'Kafka en la orilla',
    a: ['Haruki Murakami'],
    g: ['Novela'],
    pub: 'Tusquets',
    y: 2006,
    l: 'es',
    p: 592,
    isbn: '978848383242',
    loc: null,
    cond: 'new',
    acq: '2026-10-25',
    notes: { en: 'Still in the backpack, not shelved yet.', es: 'Aún en la mochila, sin colocar.' },
  },
];

export function loadDemo(catalog: CatalogService, lang: Lang = 'en'): { locations: number; books: number } {
  if (
    catalog.library({ sort: 'title', limit: 1, offset: 0 }).total > 0 ||
    catalog.locationTree().items.length > 0
  ) {
    throw new Error('The library is not empty: sample data can only be loaded into a new library.');
  }
  const ids = new Map<string, string>();
  for (const [key, name, parent, kind] of LOCATIONS) {
    const before = new Set(catalog.locationTree().items.map((l) => l.id));
    const tree = catalog.createLocation(
      LocationCreate.parse({ name: name[lang], kind, parentId: parent ? ids.get(parent)! : null }),
    );
    ids.set(key, tree.items.find((l) => !before.has(l.id))!.id);
  }
  for (const b of BOOKS) {
    const res = catalog.createBook(
      BookCreate.parse({
        work: { title: b.t, authors: b.a, subjects: b.g },
        edition: {
          publisher: b.pub,
          publishedYear: b.y,
          language: b.l,
          pages: b.p,
          isbn13: b.isbn ? withCheckDigit(b.isbn) : null,
          metadataSource: lang === 'es' ? 'Datos de ejemplo' : 'Sample data',
        },
        copy: {
          locationId: b.loc ? ids.get(b.loc) : null,
          condition: b.cond ?? 'good',
          acquiredOn: b.acq,
          notes: b.notes?.[lang] ?? '',
        },
      }),
    );
    for (const extra of b.extra ?? []) {
      catalog.createCopy({
        editionId: res.created.editionId,
        locationId: ids.get(extra)!,
        condition: 'new',
        acquiredOn: '2026-01-06',
        priceCents: null,
        priceCurrency: 'EUR',
        notes: lang === 'es' ? 'Regalo de Reyes (repetido).' : 'Christmas present (a duplicate).',
      });
    }
  }
  return { locations: LOCATIONS.length, books: BOOKS.length };
}
