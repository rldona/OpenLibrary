import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useListView } from '../src/lib/listView';
import { renderUi } from './render';

function Probe({ k = 'probe' }: { k?: string }) {
  const [view, setView] = useListView(k);
  return (
    <>
      <output>{view}</output>
      <button onClick={() => setView('table')}>choose table</button>
    </>
  );
}

describe('list view preference', () => {
  it('survives navigating away and back, even when the URL loses its view', async () => {
    const user = userEvent.setup();
    localStorage.removeItem('openlibrary.view.probe');
    history.replaceState(null, '', '/library');

    const first = renderUi(<Probe />);
    expect(screen.getByText('grid')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'choose table' }));
    expect(screen.getByText('table')).toBeTruthy();
    expect(new URLSearchParams(location.search).get('view')).toBe('table');
    first.unmount();

    // Another page drops the query string; coming back must still show the table.
    history.replaceState(null, '', '/wishlist');
    renderUi(<Probe />);
    expect(screen.getByText('table')).toBeTruthy();
  });

  it('keeps a separate view for each list', async () => {
    const user = userEvent.setup();
    localStorage.removeItem('openlibrary.view.library');
    localStorage.removeItem('openlibrary.view.favorites');

    history.replaceState(null, '', '/');
    const library = renderUi(<Probe k="library" />);
    await user.click(screen.getByRole('button', { name: 'choose table' }));
    library.unmount();

    // Opening Favorites (another list/key) starts with its own preference, not the library's table.
    history.replaceState(null, '', '/favorites');
    const favorites = renderUi(<Probe k="favorites" />);
    expect(screen.getByText('grid')).toBeTruthy();
    favorites.unmount();

    history.replaceState(null, '', '/');
    renderUi(<Probe k="library" />);
    expect(screen.getByText('table')).toBeTruthy();
    expect(localStorage.getItem('openlibrary.view.favorites')).toBeNull();
  });
});
