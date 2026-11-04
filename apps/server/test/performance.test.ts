/**
 * F1 criterion: search < 150 ms with 10,000 synthetic copies.
 * F2: the first sync (snapshot) of that library stays well within the 10 s budget.
 * Data is inserted straight through the service (no HTTP) so the setup is fast.
 */
import { describe, expect, it } from 'vitest';
import { CatalogService } from '../src/catalog/service.js';
import { SyncService } from '../src/sync/service.js';
import { openDb } from '../src/db/client.js';
import { LibraryQuery } from '@openlibrary/contracts';

const WORDS = [
  'sombra',
  'viento',
  'noche',
  'casa',
  'mar',
  'tiempo',
  'ciudad',
  'río',
  'jardín',
  'espejo',
  'camino',
  'silencio',
];
const NAMES = ['Ana', 'Luis', 'Marta', 'Jorge', 'Lucía', 'Pablo', 'Elena', 'Andrés'];
const SURNAMES = ['García', 'Martínez', 'López', 'Sánchez', 'Pérez', 'Gómez', 'Díaz', 'Álvarez'];
const pick = <T>(a: T[], i: number) => a[i % a.length]!;

describe('performance', () => {
  it('10,000 copies: searches and filters under 150 ms', () => {
    const db = openDb(':memory:');
    const cat = new CatalogService(db);
    const tree = cat.createLocation({ parentId: null, name: 'Casa', kind: 'home', sortOrder: 0 });
    const casa = tree.items[0]!.id;
    const shelves: string[] = [];
    for (let r = 0; r < 4; r++) {
      const room = cat
        .createLocation({ parentId: casa, name: `Habitación ${r}`, kind: 'room', sortOrder: r })
        .items.find((l) => l.name === `Habitación ${r}`)!.id;
      for (let s = 0; s < 10; s++) {
        shelves.push(
          cat
            .createLocation({ parentId: room, name: `Balda ${r}-${s}`, kind: 'shelf', sortOrder: s })
            .items.find((l) => l.name === `Balda ${r}-${s}`)!.id,
        );
      }
    }
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      cat.createBook({
        work: {
          title: `${pick(WORDS, i)} ${pick(WORDS, i * 7 + 3)} ${i}`,
          subtitle: null,
          authors: [`${pick(NAMES, i)} ${pick(SURNAMES, i * 3)}`],
          subjects: [pick(['Novela', 'Ensayo', 'Poesía', 'Historia'], i)],
          description: null,
          originalTitle: null,
          originalLanguage: null,
          series: null,
          seriesIndex: null,
        },
        edition: {
          title: null,
          subtitle: null,
          publisher: pick(['Anagrama', 'Alfaguara', 'Debolsillo'], i),
          publishedYear: 1950 + (i % 70),
          language: i % 5 ? 'es' : 'en',
          pages: 200,
          format: null,
          isbn13: null,
          coverAssetId: null,
          metadataStatus: 'complete',
          metadataSource: null,
        },
        copy: {
          locationId: pick(shelves, i),
          condition: 'good',
          acquiredOn: `20${10 + (i % 15)}-0${1 + (i % 9)}-1${i % 9}`,
          priceCents: null,
          priceCurrency: 'EUR',
          notes: '',
        },
        allowDuplicateIsbn: false,
      });
    }
    const setup = performance.now() - t0;

    const room1 = cat.locationTree().items.find((l) => l.name === 'Habitación 1')!.id;
    const queries = [
      { q: 'sombra' },
      { q: 'garcia' },
      { q: 'balda 2-3' },
      { location: room1 },
      { subject: 'Ensayo', sort: 'author' },
      { sort: 'acquired' },
      { sort: 'location' },
      { q: 'mar tiempo', language: 'es' },
    ] as const;
    const times: Record<string, number> = {};
    for (const q of queries) {
      const page = cat.library(LibraryQuery.parse(q));
      times[JSON.stringify(q)] = page.tookMs;
      expect(page.tookMs).toBeLessThan(150);
      expect(page.items.length).toBeGreaterThan(0);
    }
    console.log(`Alta de 10 000 libros: ${Math.round(setup)} ms`, times);

    const t1 = performance.now();
    const snapshot = new SyncService(db, cat).snapshot();
    const bytes = JSON.stringify(snapshot).length;
    const snapshotMs = performance.now() - t1;
    expect(snapshot.copies).toHaveLength(10_000);
    expect(snapshotMs).toBeLessThan(2000);
    console.log(`Snapshot of 10,000 copies: ${Math.round(snapshotMs)} ms, ${(bytes / 1e6).toFixed(1)} MB`);
  }, 120_000);
});
