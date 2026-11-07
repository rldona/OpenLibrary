import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, LoadingState } from '../src/components/states';
import { axeViolations, renderUi } from './render';

describe('states', () => {
  it('EmptyState shows its title, text and action without axe violations', async () => {
    renderUi(
      <main>
        <EmptyState
          icon="list"
          title="No wishes"
          text="Add the books you want to buy."
          action={<button>Add wish</button>}
        />
      </main>,
    );
    expect(screen.getByRole('heading', { name: 'No wishes' })).toBeTruthy();
    expect(screen.getByText('Add the books you want to buy.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add wish' })).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('LoadingState says nothing during the first 300 ms', () => {
    vi.useFakeTimers();
    const view = within(
      renderUi(
        <main>
          <LoadingState />
        </main>,
      ).container,
    );
    expect(view.getByRole('status').textContent).toBe('');
    act(() => vi.advanceTimersByTime(300));
    expect(view.getByRole('status').textContent).toBe('Loading…');
    vi.useRealTimers();
  });

  it('ErrorState explains the failure and retries', async () => {
    const onRetry = vi.fn();
    const { container } = renderUi(
      <main>
        <ErrorState error={new TypeError('offline')} onRetry={onRetry} />
      </main>,
    );
    expect(within(container).getByRole('alert').textContent).toContain('Cannot reach the server.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
