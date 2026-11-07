import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Rating } from '../src/components/rating';
import { Segmented } from '../src/components/segmented';
import { axeViolations, renderUi } from './render';

function RatingHarness({ initial = null as number | null, onChange = vi.fn() }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <main>
      <Rating
        label="Rating"
        value={value}
        onChange={(v) => {
          onChange(v);
          setValue(v);
        }}
      />
    </main>
  );
}

const checked = () =>
  screen
    .getAllByRole('radio')
    .filter((r) => r.getAttribute('aria-checked') === 'true')
    .map((r) => r.getAttribute('aria-label'));

describe('Rating', () => {
  it('is a group of five radios; a click sets that many stars and a second one clears them', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(<RatingHarness onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Rating' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    await user.click(screen.getByRole('radio', { name: '4 of 5' }));
    expect(onChange).toHaveBeenLastCalledWith(4);
    expect(checked()).toEqual(['4 of 5']);
    await user.click(screen.getByRole('radio', { name: '4 of 5' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(checked()).toEqual([]);
  });

  it('moves and chooses with the arrows, Home and End, and clears with Delete', async () => {
    const user = userEvent.setup();
    renderUi(<RatingHarness initial={3} />);
    const three = screen.getByRole('radio', { name: '3 of 5' });
    // One tab stop: the chosen star.
    expect(screen.getAllByRole('radio').map((r) => r.tabIndex)).toEqual([-1, -1, 0, -1, -1]);
    three.focus();
    await user.keyboard('{ArrowRight}');
    expect(checked()).toEqual(['4 of 5']);
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '4 of 5' }));
    await user.keyboard('{Home}');
    expect(checked()).toEqual(['1 of 5']);
    await user.keyboard('{End}');
    expect(checked()).toEqual(['5 of 5']);
    await user.keyboard('{Delete}');
    expect(checked()).toEqual([]);
  });

  it('shows a half rating set elsewhere and rounds from it with the arrows', async () => {
    const user = userEvent.setup();
    const { container } = renderUi(<RatingHarness initial={3.5} />);
    expect(container.querySelectorAll('.star-full')).toHaveLength(4);
    expect(checked()).toEqual([]);
    const stop = screen.getAllByRole('radio').find((r) => r.tabIndex === 0)!;
    expect(stop.getAttribute('aria-label')).toBe('4 of 5');
    stop.focus();
    await user.keyboard('{ArrowLeft}');
    expect(checked()).toEqual(['3 of 5']);
  });

  it('removes the rating from its button and has no axe violations', async () => {
    const user = userEvent.setup();
    renderUi(<RatingHarness initial={2} />);
    expect(await axeViolations(document.body)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Remove the rating' }));
    expect(checked()).toEqual([]);
  });
});

type P = 'low' | 'normal' | 'high';
function SegHarness({ mode, onChange = vi.fn() }: { mode: 'select' | 'action'; onChange?: (v: P) => void }) {
  const [value, setValue] = useState<P>('normal');
  return (
    <main>
      <Segmented<P>
        label="Priority"
        mode={mode}
        value={value}
        onChange={(v) => {
          onChange(v);
          setValue(v);
        }}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High', disabled: mode === 'action' },
        ]}
      />
    </main>
  );
}

describe('Segmented', () => {
  it('as a radio group, chooses with the arrows', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(<SegHarness mode="select" onChange={onChange} />);
    const normal = screen.getByRole('radio', { name: 'Normal' });
    expect(normal.getAttribute('aria-checked')).toBe('true');
    normal.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('high');
    expect(screen.getByRole('radio', { name: 'High' }).getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('low');
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('as actions, the arrows only move (skipping what cannot be chosen) and Enter chooses', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(<SegHarness mode="action" onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'Priority' })).toBeTruthy();
    const normal = screen.getByRole('button', { name: 'Normal' });
    expect(normal.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'High' }) as HTMLButtonElement).disabled).toBe(true);
    normal.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Low' }));
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('low');
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
