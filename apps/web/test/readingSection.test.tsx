import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReadingDTO, WorkDetail } from '@openlibrary/contracts/client';
import { ReadingSection } from '../src/pages/ReadingSection';
import { axeViolations, renderUi } from './render';

const T = '2026-11-01T10:00:00.000Z';
const copy = (id: string, code: string) => ({
  id,
  version: 1,
  editionId: 'e1',
  code,
  locationId: null,
  locationPath: [],
  condition: 'good' as const,
  acquiredOn: null,
  priceCents: null,
  priceCurrency: 'EUR',
  notes: '',
  status: 'active' as const,
  retiredReason: null,
  retiredOn: null,
  createdAt: T,
  updatedAt: T,
});
const reading = (id: string, status: ReadingDTO['status'], extra: Partial<ReadingDTO> = {}): ReadingDTO => ({
  id,
  version: 1,
  copyId: 'c1',
  status,
  startedOn: '2026-11-01',
  finishedOn: null,
  rating: null,
  notes: '',
  createdAt: T,
  updatedAt: T,
  ...extra,
});
const work = (readings: ReadingDTO[], readingStatus: WorkDetail['readingStatus']): WorkDetail =>
  ({
    work: { id: 'w1', title: 'Dune', authors: [], subjects: [] },
    editions: [{ id: 'e1', copies: [copy('c1', 'EJ-0001')] }],
    readings,
    readingStatus,
    quotes: [],
  }) as unknown as WorkDetail;

/** Answers each request when `release()` is called, so a test can look at the busy state. */
let calls: { method: string; url: string; body: unknown }[];
let release: () => void;
beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({
        method: init.method ?? 'GET',
        url,
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
      return new Promise<Response>((resolve) => {
        release = () =>
          resolve(new Response(JSON.stringify(work([reading('r1', 'reading')], 'reading')), { status: 200 }));
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const render = (w: WorkDetail) =>
  renderUi(
    <main>
      <ReadingSection data={w} />
    </main>,
  );

describe('ReadingSection', () => {
  it('starts a reading from the status segments, once, while it is being saved', async () => {
    const user = userEvent.setup();
    render(work([], 'pending'));
    const group = screen.getByRole('group', { name: 'Reading status' });
    expect(screen.getByRole('button', { name: 'Not read yet' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Reading' }));
    await user.click(screen.getByRole('button', { name: 'Reading' }));
    expect(group.getAttribute('aria-busy')).toBe('true');
    expect(calls).toEqual([
      { method: 'POST', url: '/api/v1/reading-sessions', body: { copyId: 'c1', status: 'reading' } },
    ]);
    release();
    await waitFor(() => expect(group.getAttribute('aria-busy')).toBeNull());
  });

  it('resets a reading in progress to "Not read yet"', async () => {
    const user = userEvent.setup();
    const r = reading('r1', 'reading');
    render(work([r], 'reading'));
    const notRead = screen.getByRole('button', { name: 'Not read yet' }) as HTMLButtonElement;
    expect(notRead.disabled).toBe(false);
    await user.click(notRead);
    expect(calls[0]).toEqual({
      method: 'PATCH',
      url: '/api/v1/reading-sessions/r1',
      body: { baseVersion: 1, fields: { status: 'pending', startedOn: null, finishedOn: null } },
    });
    release();
  });

  it('keeps "Not read yet" disabled after a finished reading (a re-read)', () => {
    render(work([reading('r1', 'read'), reading('r2', 'reading')], 'reading'));
    expect((screen.getByRole('button', { name: 'Not read yet' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('finishes the reading in progress with "Read" and offers "Abandon"', async () => {
    const user = userEvent.setup();
    const r = reading('r1', 'reading');
    render(work([r, reading('r2', 'abandoned')], 'reading'));
    await user.click(screen.getByRole('button', { name: 'Read' }));
    expect(calls[0]).toEqual({
      method: 'PATCH',
      url: '/api/v1/reading-sessions/r1',
      body: { baseVersion: 1, fields: { status: 'read' } },
    });
    release();
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Reading status' }).getAttribute('aria-busy')).toBeNull(),
    );
    await user.click(screen.getByRole('button', { name: 'Abandon' }));
    expect(calls[1]!.body).toEqual({ baseVersion: 1, fields: { status: 'abandoned' } });
  });

  it('rates the latest reading with the stars and edits its notes with an explicit save', async () => {
    const user = userEvent.setup();
    render(work([reading('r1', 'read', { rating: 3, notes: 'Spice' })], 'read'));
    await user.click(screen.getByRole('radio', { name: '5 of 5' }));
    expect(calls[0]!.body).toEqual({ baseVersion: 1, fields: { rating: 5 } });
    release();
    await waitFor(() => expect(screen.getByRole('radiogroup').getAttribute('aria-busy')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Edit notes' }));
    const box = screen.getByRole('textbox', { name: 'Notes on this reading' });
    await user.clear(box);
    await user.type(box, 'Fear is the mind-killer');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(calls[1]!.body).toEqual({ baseVersion: 1, fields: { notes: 'Fear is the mind-killer' } });
    release();
    await screen.findByText('Notes saved');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit notes' }));
  });

  it('saves a date typed digit by digit once, with its final value', async () => {
    render(work([reading('r1', 'reading')], 'reading'));
    const started = screen.getByLabelText('Started');
    // A date field goes through 0002, 0020, 0202… while a year is typed.
    for (const v of ['0002-11-01', '0020-11-01', '0202-11-01', '2025-11-01'])
      fireEvent.change(started, { target: { value: v } });
    expect(calls).toEqual([]);
    fireEvent.blur(started);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls).toEqual([
      {
        method: 'PATCH',
        url: '/api/v1/reading-sessions/r1',
        body: { baseVersion: 1, fields: { startedOn: '2025-11-01' } },
      },
    ]);
    release();
  });

  it('queues changes made while one is being saved instead of dropping them', async () => {
    const user = userEvent.setup();
    render(work([reading('r1', 'read', { rating: 3 })], 'read'));
    await user.click(screen.getByRole('radio', { name: '4 of 5' }));
    await user.click(screen.getByRole('radio', { name: '5 of 5' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    release();
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => c.body)).toEqual([
      { baseVersion: 1, fields: { rating: 4 } },
      { baseVersion: 1, fields: { rating: 5 } },
    ]);
    release();
  });

  it('labels the dates and has no axe violations', async () => {
    render(work([reading('r1', 'reading')], 'reading'));
    expect(screen.getByLabelText('Started')).toBeTruthy();
    expect(screen.getByLabelText('Finished')).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
