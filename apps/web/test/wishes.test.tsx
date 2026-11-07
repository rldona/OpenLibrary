import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WishDTO } from '@openlibrary/contracts/client';
import { arrangeWishes, wishViewOf } from '../src/lib/wishes';
import { Wishlist } from '../src/pages/Wishlist';
import { renderUi } from './render';

const wish = (id: string, title: string, priority: WishDTO['priority'], createdAt: string): WishDTO => ({
  id,
  version: 1,
  title,
  authors: [],
  isbn13: null,
  workId: null,
  priority,
  notes: '',
  status: 'open',
  acquiredCopyId: null,
  coverAssetId: null,
  createdAt,
  updatedAt: createdAt,
});
const WISHES = [
  wish('1', 'Zama', 'low', '2026-01-03T00:00:00.000Z'),
  wish('2', 'Ábaco', 'high', '2026-01-01T00:00:00.000Z'),
  wish('3', 'Dune', 'normal', '2026-01-04T00:00:00.000Z'),
  wish('4', 'Babel', 'high', '2026-01-02T00:00:00.000Z'),
];
const titles = (ws: WishDTO[]) => ws.map((w) => w.title);

describe('wish order and filter', () => {
  it('reads them from the URL, with priority as the default order', () => {
    expect(wishViewOf(new URLSearchParams(''))).toEqual({ sort: 'priority', priority: undefined });
    expect(wishViewOf(new URLSearchParams('?sort=title&priority=low'))).toEqual({
      sort: 'title',
      priority: 'low',
    });
    expect(wishViewOf(new URLSearchParams('?sort=nope&priority=urgent'))).toEqual({
      sort: 'priority',
      priority: undefined,
    });
  });

  it('orders by priority (newest first within one), by date added and by title ignoring accents', () => {
    expect(titles(arrangeWishes(WISHES, { sort: 'priority', priority: undefined }))).toEqual([
      'Babel',
      'Ábaco',
      'Dune',
      'Zama',
    ]);
    expect(titles(arrangeWishes(WISHES, { sort: 'added', priority: undefined }))).toEqual([
      'Dune',
      'Zama',
      'Babel',
      'Ábaco',
    ]);
    expect(titles(arrangeWishes(WISHES, { sort: 'title', priority: undefined }))).toEqual([
      'Ábaco',
      'Babel',
      'Dune',
      'Zama',
    ]);
    expect(titles(arrangeWishes(WISHES, { sort: 'title', priority: 'high' }))).toEqual(['Ábaco', 'Babel']);
  });
});

describe('Wishlist filters', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/wishlist')
          ? new Response(JSON.stringify({ items: WISHES }), { status: 200 })
          : new Response('{}', { status: 404 }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const listed = () =>
    within(document.querySelector('ul.list') as HTMLElement)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('b')!.textContent);

  it('switches between covers and the table, remembering it', async () => {
    const user = userEvent.setup();
    history.replaceState(null, '', '/wishlist');
    localStorage.removeItem('openlibrary.view.wishlist');
    renderUi(
      <main>
        <Wishlist onBought={vi.fn()} />
      </main>,
    );
    await waitFor(() => expect(listed()).toHaveLength(4));

    await user.click(screen.getByRole('button', { name: 'Covers' }));
    expect(document.querySelector('.grid .card')).toBeTruthy();
    expect(document.querySelector('ul.list')).toBeNull();
    expect(localStorage.getItem('openlibrary.view.wishlist')).toBe('grid');

    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(document.querySelector('ul.list')).toBeTruthy();
    expect(document.querySelector('.grid')).toBeNull();
  });

  it('filters by priority and orders from the chip menus, in the URL', async () => {
    const user = userEvent.setup();
    history.replaceState(null, '', '/wishlist?priority=high');
    renderUi(
      <main>
        <Wishlist onBought={vi.fn()} />
      </main>,
    );
    await waitFor(() => expect(listed()).toEqual(['Babel', 'Ábaco']));
    expect(screen.getByRole('button', { name: 'Priority: High' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Sort: Priority' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Title' }));
    expect(new URLSearchParams(location.search).get('sort')).toBe('title');

    await user.click(screen.getByRole('button', { name: 'Priority: High' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Any priority' }));
    expect(new URLSearchParams(location.search).get('priority')).toBeNull();
  });
});
