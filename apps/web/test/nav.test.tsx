import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MainNav } from '../src/components/nav';
import { useNavMode } from '../src/lib/media';
import { axeViolations, renderUi, setWidth } from './render';

const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

function Nav() {
  const mode = useNavMode();
  return (
    <div data-mode={mode}>
      <MainNav mode={mode} view="wishlist" counts={{ wishlist: 2, locations: 15 }} onSignOut={vi.fn()} />
    </div>
  );
}

/** Checks the navigation's links by accessible name, in order. */
function expectLinks(names: string[]) {
  const nav = within(screen.getByRole('navigation', { name: 'Main menu' }));
  const links = nav.getAllByRole('link');
  expect(links).toHaveLength(names.length);
  names.forEach((name, i) => expect(nav.getByRole('link', { name })).toBe(links[i]));
}

describe('adaptive navigation', () => {
  it('is a bottom bar with the six main destinations below 600 px', async () => {
    setWidth(375);
    const { container } = renderUi(<Nav />);
    expect(container.querySelector('[data-mode]')!.getAttribute('data-mode')).toBe('bar');
    expect(container.querySelector('.bottom-bar')).toBeTruthy();
    expectLinks(['Library', 'Favorites', 'Locations 15', 'Wishlist 2', 'Statistics', 'Settings']);
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.getByRole('link', { name: /Wishlist/ }).getAttribute('aria-current')).toBe('page');
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('is a rail with short labels and badges from 600 to 1199 px', () => {
    setWidth(800);
    const { container } = renderUi(<Nav />);
    expect(container.querySelector('.side.rail')).toBeTruthy();
    expectLinks(['Library', 'Favorites', 'Locations 15', 'Wishlist 2', 'Statistics', 'Data', 'Settings']);
    expect(container.querySelector('.badge-n')!.textContent).toBe('15');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('is the side menu from 1200 px', () => {
    setWidth(1280);
    const { container } = renderUi(<Nav />);
    expect(container.querySelector('.side:not(.rail)')).toBeTruthy();
    expect(container.querySelector('.brand')!.textContent).toBe('OpenLibrary');
    expectLinks([
      'Library',
      'Favorites',
      'Locations 15',
      'Wish list 2',
      'Statistics',
      'Import and export',
      'Settings',
    ]);
    expect(container.querySelector('.badge-n')).toBeNull();
  });
});
