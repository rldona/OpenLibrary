import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { DriveBackupStatus } from '@openlibrary/contracts/client';
import { DriveBackups } from '../src/pages/DriveBackups';
import { axeViolations, renderUi } from './render';

const base: DriveBackupStatus = {
  drive: { available: true, connected: false, account: null },
  intervalMinutes: 0,
  running: false,
  upToDate: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFile: null,
  lastError: null,
  nextCheckAt: null,
};

/** Fake server: answers every request with `status`, recording what was asked. */
function serve(status: DriveBackupStatus, extra: Record<string, unknown> = {}) {
  const calls: { method: string; url: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? 'GET', url, body: init.body as string | undefined });
      const body = url.endsWith('/connect') ? extra : status;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

describe('Backups to Google Drive', () => {
  it('says when the server has no Google credentials', async () => {
    serve({ ...base, drive: { available: false, connected: false, account: null } });
    renderUi(<DriveBackups />);
    expect(await screen.findByText(/GOOGLE_OAUTH_CLIENT_ID/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Google Drive' })).toBeNull();
  });

  it('connecting sends the browser to Google', async () => {
    const calls = serve(base, { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderUi(<DriveBackups />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Google Drive' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'),
    );
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/backups/drive/connect'))).toBe(true);
  });

  it('when connected: status, error, frequency and back up now', async () => {
    const calls = serve({
      ...base,
      drive: { available: true, connected: true, account: 'owner@example.com' },
      intervalMinutes: 5,
      upToDate: true,
      lastSuccessAt: '2026-11-13T10:00:00.000Z',
      lastError: 'Google Drive cannot be reached.',
      nextCheckAt: '2026-11-13T10:05:00.000Z',
    });
    const { container } = renderUi(<DriveBackups />);
    expect(await screen.findByText('owner@example.com')).toBeTruthy();
    expect(screen.getByText('Up to date')).toBeTruthy();
    expect(
      screen.getAllByRole('alert').some((a) => a.textContent?.includes('Google Drive cannot be reached.')),
    ).toBe(true);
    expect(screen.getByRole('radio', { name: '5 min' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: '15 min' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
        url: '/api/v1/backups/drive/settings',
        body: JSON.stringify({ intervalMinutes: 15 }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/backups/drive/run')).toBe(true),
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('reports the result of the Google consent and clears it from the address', async () => {
    serve({ ...base, drive: { available: true, connected: true, account: null } });
    history.replaceState(null, '', '/data?drive=connected');
    renderUi(<DriveBackups />);
    expect(await screen.findByText('Google Drive connected')).toBeTruthy();
    expect(location.search).toBe('');
  });
});
