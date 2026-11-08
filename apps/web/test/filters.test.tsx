import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SelectMenu } from '../src/components/menu';
import { LibraryFilters, libraryQueryOf } from '../src/pages/LibraryFilters';
import { axeViolations, renderUi } from './render';

const ITEMS = [
  { value: '', label: 'Any reading status' },
  { value: 'pending', label: 'Not read yet' },
  { value: 'reading', label: 'Reading' },
  { value: 'read', label: 'Read' },
];

function Harness({ onChange = vi.fn() }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <main>
      <SelectMenu
        name="Reading"
        items={ITEMS}
        value={value}
        active={!!value}
        onChange={(v) => {
          onChange(v);
          setValue(v);
        }}
      >
        {value ? `Reading: ${ITEMS.find((i) => i.value === value)!.label}` : 'Reading'}
      </SelectMenu>
      <button>After</button>
    </main>
  );
}

describe('SelectMenu', () => {
  it('opens on the chosen item, moves with the arrows and picks with Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(<Harness onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'Reading' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    button.focus();
    await user.keyboard('{ArrowDown}');
    const menu = screen.getByRole('menu', { name: 'Reading' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Any reading status' }));
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    // Wraps around.
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Any reading status' }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Read' }));
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('read');
    expect(screen.queryByRole('menu')).toBeNull();
    const chip = screen.getByRole('button', { name: 'Reading: Read' });
    expect(document.activeElement).toBe(chip);

    // Reopened, the focus is on the chosen item, which is checked.
    await user.keyboard('{Enter}');
    const checked = screen.getByRole('menuitemradio', { name: 'Read' });
    expect(checked.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(checked);
  });

  it('jumps to an item by its first letter and closes with Escape, giving the focus back', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(<Harness onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'Reading' });
    await user.click(button);
    await user.keyboard('n');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Not read yet' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on a click elsewhere', async () => {
    const user = userEvent.setup();
    renderUi(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Reading' }));
    await user.click(screen.getByRole('button', { name: 'After' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('has no axe violations while open', async () => {
    const user = userEvent.setup();
    renderUi(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Reading' }));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('Library filters', () => {
  const render = (search: string) => {
    history.replaceState(null, '', `/${search}`);
    const q = libraryQueryOf(new URLSearchParams(search));
    renderUi(
      <main>
        <LibraryFilters q={q} />
      </main>,
    );
    return q;
  };

  it('reads every filter from the URL', () => {
    expect(libraryQueryOf(new URLSearchParams('?reading=read&toComplete=1&lang=es&q=dune'))).toMatchObject({
      reading: 'read',
      provisional: true,
      language: 'es',
      q: 'dune',
      sort: 'title',
    });
    expect(libraryQueryOf(new URLSearchParams('?reading=abandoned')).reading).toBeUndefined();
  });

  it('sets the reading filter from its chip menu, in the URL', async () => {
    const user = userEvent.setup();
    render('');
    await user.click(screen.getByRole('button', { name: 'Reading' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Read' }));
    expect(new URLSearchParams(location.search).get('reading')).toBe('read');
  });

  it('toggles "To complete" as a pressed chip', async () => {
    const user = userEvent.setup();
    render('');
    const chip = screen.getByRole('button', { name: 'To complete' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    await user.click(chip);
    expect(new URLSearchParams(location.search).get('toComplete')).toBe('1');
  });

  it('lists the filters in use, removes one and clears them all', async () => {
    const user = userEvent.setup();
    render('?reading=reading&toComplete=1&q=dune&sort=author');
    const group = screen.getByRole('group', { name: 'Active filters' });
    expect(within(group).getByRole('button', { name: 'Remove filter: Reading: Reading' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Remove filter: To complete' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Remove filter: Search: “dune”' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'To complete' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Sort: Author A→Z' })).toBeTruthy();

    await user.click(within(group).getByRole('button', { name: 'Remove filter: Reading: Reading' }));
    let p = new URLSearchParams(location.search);
    expect(p.get('reading')).toBeNull();
    expect(p.get('toComplete')).toBe('1');

    await user.click(within(group).getByRole('button', { name: 'Clear filters' }));
    p = new URLSearchParams(location.search);
    expect([p.get('toComplete'), p.get('q')]).toEqual([null, null]);
    // The order is not a filter.
    expect(p.get('sort')).toBe('author');
  });

  it('chooses the order from a menu with a check', async () => {
    const user = userEvent.setup();
    render('');
    await user.click(screen.getByRole('button', { name: 'Sort: Title A→Z' }));
    expect(screen.getByRole('menuitemradio', { name: 'Title A→Z' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'Acquired (newest)' }));
    expect(new URLSearchParams(location.search).get('sort')).toBe('acquired');
  });
});
