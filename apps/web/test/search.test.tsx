import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LibraryItem } from '@openlibrary/contracts/client';
import { SearchBox } from '../src/components/search';
import { addRecentSearch, clearRecentSearches, recentSearches } from '../src/lib/recent';
import { axeViolations, renderUi } from './render';

const book = (title: string, n: number): LibraryItem => ({
  editionId: `ed-${n}`,
  workId: `work-${n}`,
  title,
  subtitle: null,
  authors: ['Frank Herbert'],
  subjects: [],
  publisher: null,
  publishedYear: 1965,
  language: 'en',
  isbn13: null,
  coverAssetId: null,
  metadataStatus: 'complete',
  editionCount: 1,
  copies: [],
  lastAcquiredOn: null,
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearRecentSearches();
  history.replaceState(null, '', '/stats');
  fetchMock = vi.fn(async (url: string) => {
    const q = new URL(url, 'http://x').searchParams.get('q') ?? '';
    const items = q.startsWith('dun') ? [book('Dune', 1), book('Dune Messiah', 2)] : [];
    return new Response(JSON.stringify({ items, total: items.length, tookMs: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function setup(live = false) {
  const onSearch = vi.fn();
  // In the app the box is in the page header (a landmark).
  renderUi(
    <header>
      <SearchBox value="" onSearch={onSearch} live={live} />
    </header>,
  );
  const box = screen.getByRole('combobox', { name: 'Search the library' });
  return { onSearch, box, user: userEvent.setup() };
}

describe('SearchBox', () => {
  it('offers the recent searches on focus and runs one with the keyboard', async () => {
    addRecentSearch('orwell');
    addRecentSearch('dune');
    const { box, user, onSearch } = setup();
    expect(box.getAttribute('aria-expanded')).toBe('false');
    await user.click(box);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('listbox', { name: 'Recent searches' });
    expect(box.getAttribute('aria-controls')).toBe(list.id);
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['dune', 'orwell']);

    await user.keyboard('{ArrowDown}{ArrowDown}');
    const active = document.getElementById(box.getAttribute('aria-activedescendant')!);
    expect(active?.textContent).toBe('orwell');
    expect(active?.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Enter}');
    expect(onSearch).toHaveBeenCalledWith('orwell');
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(recentSearches()[0]).toBe('orwell');
  });

  it('removes one recent search with Delete and all of them with "Clear history"', async () => {
    addRecentSearch('a');
    addRecentSearch('b');
    addRecentSearch('c');
    const { box, user } = setup();
    await user.click(box);
    await user.keyboard('{ArrowDown}{Delete}');
    expect(recentSearches()).toEqual(['b', 'a']);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['b', 'a']);
    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(recentSearches()).toEqual([]);
    expect(box.getAttribute('aria-expanded')).toBe('false');
  });

  it('suggests matching books while typing and opens one with Enter', async () => {
    const { box, user, onSearch } = setup();
    await user.type(box, 'dun');
    const list = await screen.findByRole('listbox', { name: 'Books' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(2));
    expect(fetchMock.mock.calls.at(-1)![0]).toContain('limit=6');
    await waitFor(() =>
      expect(box.parentElement!.querySelector('[role=status]')!.textContent).toBe('2 books found'),
    );
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(new URLSearchParams(location.search).get('book')).toBe('work-2');
    expect(new URLSearchParams(location.search).get('ed')).toBe('ed-2');
    // Opening a result remembers the search, without applying it to the library.
    expect(recentSearches()).toEqual(['dun']);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('searches the library with Enter when no option is chosen, and says when nothing matches', async () => {
    const { box, user, onSearch } = setup();
    await user.type(box, 'zzz');
    await screen.findByText('No books match. Press Enter to search the whole library.', {
      selector: 'p',
    });
    expect(box.getAttribute('aria-activedescendant')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onSearch).toHaveBeenCalledWith('zzz');
    expect(recentSearches()).toEqual(['zzz']);
  });

  it('filters the library as you type when it is on screen', async () => {
    const { box, user, onSearch } = setup(true);
    await user.type(box, 'dune');
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith('dune'));
  });

  it('closes with Escape, then empties the box; the clear button empties it too', async () => {
    const { box, user, onSearch } = setup();
    await user.type(box, 'dun');
    await screen.findAllByRole('option');
    await user.keyboard('{Escape}');
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect((box as HTMLInputElement).value).toBe('dun');
    await user.keyboard('{Escape}');
    expect((box as HTMLInputElement).value).toBe('');

    await user.type(box, 'abc');
    await user.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect((box as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(box);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('drops a search still waiting when the library leaves the screen', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    const ui = (live: boolean) => (
      <header>
        <SearchBox value="" onSearch={onSearch} live={live} />
      </header>
    );
    const { rerender } = renderUi(ui(true));
    await user.type(screen.getByRole('combobox'), 'dune');
    rerender(ui(false));
    await new Promise((r) => setTimeout(r, 400));
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('leaves the keys of an input method alone', async () => {
    addRecentSearch('dune');
    const { box, onSearch } = setup();
    box.focus();
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('does not take "/" while a dialog is open', async () => {
    const { box, user } = setup();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    await user.keyboard('/');
    expect(document.activeElement).not.toBe(box);
    dialog.remove();
  });

  it('jumps to the box with "/"', async () => {
    const { box, user } = setup();
    await user.keyboard('/');
    expect(document.activeElement).toBe(box);
  });

  it('has no axe violations with the list open', async () => {
    addRecentSearch('dune');
    const { box, user } = setup();
    await user.click(box);
    await user.keyboard('{ArrowDown}');
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
