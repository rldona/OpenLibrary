import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useListView } from '../src/lib/listView';
import { renderUi } from './render';

function Probe() {
  const [view, setView] = useListView('probe');
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
});
