import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SNACK_ACTION_DURATION,
  SNACK_DURATION,
  usePendingDeletes,
  useSnackbar,
  type DeferredDelete,
} from '../src/components/snackbar';
import { axeViolations, renderUi } from './render';

type Api = ReturnType<typeof useSnackbar>;
let snackbar: Api;
function Probe({ items = [] as string[] }) {
  snackbar = useSnackbar();
  const pending = usePendingDeletes();
  return (
    <ul>
      {items
        .filter((k) => !pending.has(k))
        .map((k) => (
          <li key={k}>{k}</li>
        ))}
    </ul>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const defer = (d: Partial<DeferredDelete> = {}) => {
  const commit = vi.fn(async () => undefined);
  const onUndo = vi.fn();
  act(() => snackbar.deferDelete({ key: 'wish:1', message: '“Dune” deleted', commit, onUndo, ...d }));
  return { commit, onUndo };
};
const flushPromises = () => act(async () => undefined);
/** Renders, then lets a frame pass: the snackbar's live regions are in the page before any message. */
const renderProbe = (ui: React.ReactElement) => {
  const r = renderUi(ui);
  act(() => vi.advanceTimersByTime(20));
  return r;
};

describe('Snackbar', () => {
  it('shows one message at a time, in order, each for its time', () => {
    renderProbe(<Probe />);
    act(() => {
      snackbar.show('First');
      snackbar.show('Second');
    });
    expect(screen.getByRole('status').textContent).toContain('First');
    expect(screen.queryByText('Second')).toBeNull();
    act(() => vi.advanceTimersByTime(SNACK_DURATION));
    expect(screen.getByRole('status').textContent).toContain('Second');
    act(() => vi.advanceTimersByTime(SNACK_DURATION));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('announces errors as alerts and can be closed', () => {
    renderProbe(<Probe />);
    act(() => snackbar.show('Cannot reach the server.', { kind: 'error' }));
    expect(screen.getByRole('alert').textContent).toContain('Cannot reach the server.');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Cannot reach the server.')).toBeNull();
  });

  it('has no axe violations', async () => {
    renderProbe(<Probe />);
    act(() => snackbar.show('Quote deleted', { action: { label: 'Undo', onAction: () => undefined } }));
    vi.useRealTimers();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('Deferred delete', () => {
  it('hides the item at once and does not delete it yet', () => {
    renderProbe(<Probe items={['wish:1', 'wish:2']} />);
    const { commit } = defer();
    expect(screen.queryByText('wish:1')).toBeNull();
    expect(screen.getByText('wish:2')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('“Dune” deleted');
    expect(commit).not.toHaveBeenCalled();
  });

  it('"Undo" calls onUndo, never deletes and shows the item again', async () => {
    renderProbe(<Probe items={['wish:1']} />);
    const { commit, onUndo } = defer();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.getByText('wish:1')).toBeTruthy();
    act(() => vi.advanceTimersByTime(SNACK_ACTION_DURATION * 2));
    window.dispatchEvent(new Event('pagehide'));
    await flushPromises();
    expect(commit).not.toHaveBeenCalled();
  });

  it('deletes once when the snackbar times out', async () => {
    renderProbe(<Probe items={['wish:1']} />);
    const { commit, onUndo } = defer();
    act(() => vi.advanceTimersByTime(SNACK_ACTION_DURATION - 1));
    expect(commit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    await flushPromises();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ keepalive: false });
    // Leaving the page afterwards does not delete it again.
    window.dispatchEvent(new Event('pagehide'));
    await flushPromises();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('deletes when the snackbar is closed or replaced by another message', async () => {
    renderProbe(<Probe />);
    const first = defer();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await flushPromises();
    expect(first.commit).toHaveBeenCalledTimes(1);

    const second = defer({ key: 'quote:2' });
    act(() => snackbar.show('Copy updated'));
    await flushPromises();
    expect(second.commit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('Copy updated');
  });

  it('deletes with keepalive when the page is left before the snackbar goes', async () => {
    renderProbe(<Probe />);
    const { commit } = defer();
    window.dispatchEvent(new Event('pagehide'));
    await flushPromises();
    expect(commit).toHaveBeenCalledWith({ keepalive: true });
    act(() => vi.advanceTimersByTime(SNACK_ACTION_DURATION));
    await flushPromises();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('withdraws "Undo" once the tab is hidden and the deletion has run', async () => {
    renderProbe(<Probe />);
    const { commit } = defer();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(commit).toHaveBeenCalledWith({ keepalive: true });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    act(() => vi.advanceTimersByTime(SNACK_ACTION_DURATION));
    await flushPromises();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('stops waiting for a flush after its time limit', async () => {
    renderProbe(<Probe />);
    defer({ commit: () => new Promise(() => undefined) });
    let done = false;
    act(() => void snackbar.flush({ timeoutMs: 5000 }).then(() => (done = true)));
    await flushPromises();
    expect(done).toBe(false);
    act(() => vi.advanceTimersByTime(5000));
    await flushPromises();
    expect(done).toBe(true);
  });

  it('deletes what is pending when the provider unmounts', async () => {
    const { unmount } = renderProbe(<Probe />);
    const { commit } = defer();
    unmount();
    await flushPromises();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('shows the item again and an error when the deletion fails', async () => {
    renderProbe(<Probe items={['wish:1']} />);
    defer({ commit: vi.fn(async () => Promise.reject(new TypeError('offline'))) });
    act(() => vi.advanceTimersByTime(SNACK_ACTION_DURATION));
    await flushPromises();
    expect(screen.getByText('wish:1')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Cannot reach the server.');
  });
});
