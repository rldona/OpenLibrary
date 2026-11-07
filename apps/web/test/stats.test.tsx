import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { StatsDTO } from '@openlibrary/contracts/client';
import { Stats } from '../src/pages/Stats';
import { axeViolations, renderUi } from './render';

const STATS: StatsDTO = {
  collection: {
    works: 13,
    editions: 13,
    copies: 17,
    retiredCopies: 0,
    copiesWithoutLocation: 5,
    provisionalEditions: 0,
    locations: 15,
    value: [],
  },
  reading: {
    read: 1,
    reading: 1,
    pending: 11,
    finishedSessions: 1,
    abandonedSessions: 0,
    averageRating: 4.5,
    byYear: [{ year: 2026, works: 1, pages: 464 }],
  },
  acquiredByYear: [{ year: 2026, copies: 9 }],
  authors: [{ key: 'George Orwell', count: 2 }],
  subjects: [],
  languages: [{ key: 'es', count: 11 }],
  wishlistOpen: 2,
};

beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(STATS), { status: 200 })),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe('Stats', () => {
  it('has one heading level per depth, figures as name–value pairs and bars as lists', async () => {
    renderUi(
      <main>
        <Stats />
      </main>,
    );
    await screen.findByRole('heading', { level: 2, name: 'Collection' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Collection',
      'Reading',
      'Copies acquired per year',
      'Authors',
      'Subjects',
      'Languages',
    ]);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Books read per year');
    // A figure: its name (dt) and its number (dd).
    const works = screen.getByText('Works');
    expect(works.tagName).toBe('DT');
    expect(works.nextElementSibling?.textContent).toBe('13');
    // A chart: a list named by its heading, each row with its name and value as text.
    const authors = screen.getByRole('list', { name: 'Authors' });
    expect(within(authors).getByRole('listitem').textContent).toBe('George Orwell2');
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
