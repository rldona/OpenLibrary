import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login } from '../src/pages/Login';
import { PasskeysSection } from '../src/pages/Passkeys';
import { axeViolations, renderUi } from './render';

// jsdom has no WebAuthn: the browser side is replaced.
const browser = vi.hoisted(() => ({
  supported: true,
  get: vi.fn(async () => ({ id: 'cred', response: { signature: 'sig' } })),
  create: vi.fn(async () => ({ id: 'cred', response: { attestationObject: 'att' } })),
}));
vi.mock('../src/lib/passkeys', () => ({
  passkeysSupported: () => browser.supported,
  getPasskey: browser.get,
  createPasskey: browser.create,
  wasCancelled: (e: unknown) => (e as Error)?.name === 'NotAllowedError',
}));

type Route = (body: unknown) => { status?: number; json?: unknown };
let routes: Record<string, Route>;
let calls: { method: string; path: string; body: unknown }[];

const problem = (status: number, code: string, detail: string) => ({
  status,
  json: { type: `about:blank#${code}`, title: 'x', status, code, detail },
});

beforeEach(() => {
  browser.supported = true;
  browser.get.mockClear();
  browser.create.mockClear();
  calls = [];
  routes = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace('/api/v1', '');
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      const r = routes[`${method} ${path}`]?.(body) ?? { status: 404, json: {} };
      return r.status === 204
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const session = { authenticated: true, kind: 'web', sessionId: 's', expiresAt: null };
const options = { ceremonyId: 'c1', options: { challenge: 'abc' } };

describe('login', () => {
  it('without passkeys it is the password form, as before', async () => {
    routes['GET /auth/methods'] = () => ({ json: { passwordConfigured: true, passkeys: false } });
    routes['POST /auth/login'] = () => ({ json: session });
    const onDone = vi.fn();
    const { container } = renderUi(<Login onDone={onDone} />);
    await waitFor(() => expect(calls.some((c) => c.path === '/auth/methods')).toBe(true));
    expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull();
    expect(screen.queryByLabelText('Recovery code')).toBeNull();
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.find((c) => c.path === '/auth/login')!.body).toEqual({ password: 'correct horse battery' });
    expect(await axeViolations(container)).toEqual([]);
  });

  it('with passkeys, signs in with a passkey first', async () => {
    routes['GET /auth/methods'] = () => ({ json: { passwordConfigured: true, passkeys: true } });
    routes['POST /auth/login/passkey/options'] = () => ({ json: options });
    routes['POST /auth/login/passkey/verify'] = () => ({ json: session });
    const onDone = vi.fn();
    const { container } = renderUi(<Login onDone={onDone} />);
    const button = await screen.findByRole('button', { name: 'Sign in with a passkey' });
    // The password form waits behind its own button.
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(button);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(browser.get).toHaveBeenCalledWith({ challenge: 'abc' });
    expect(calls.find((c) => c.path === '/auth/login/passkey/verify')!.body).toEqual({
      ceremonyId: 'c1',
      response: { id: 'cred', response: { signature: 'sig' } },
    });
  });

  it('a cancelled passkey prompt says so, without an error from the server', async () => {
    routes['GET /auth/methods'] = () => ({ json: { passwordConfigured: true, passkeys: true } });
    routes['POST /auth/login/passkey/options'] = () => ({ json: options });
    browser.get.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    renderUi(<Login onDone={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in with a passkey' }));
    expect(await screen.findByText('No passkey was used.')).toBeTruthy();
    expect(calls.some((c) => c.path === '/auth/login/passkey/verify')).toBe(false);
  });

  it('with passkeys, the password works together with a recovery code', async () => {
    routes['GET /auth/methods'] = () => ({ json: { passwordConfigured: true, passkeys: true } });
    routes['POST /auth/login'] = () => ({ json: session });
    const onDone = vi.fn();
    renderUi(<Login onDone={onDone} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Use the password and a recovery code' }),
    );
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Recovery code'), 'abcd-efgh-jkmn');
    await userEvent.click(submit);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.find((c) => c.path === '/auth/login')!.body).toEqual({
      password: 'correct horse battery',
      recoveryCode: 'abcd-efgh-jkmn',
    });
  });

  it('a passkey-required answer reveals the recovery code field', async () => {
    routes['GET /auth/methods'] = () => ({ json: { passwordConfigured: true, passkeys: false } });
    routes['POST /auth/login'] = () => problem(403, 'passkey-required', 'Protected with a passkey.');
    browser.supported = false;
    renderUi(<Login onDone={vi.fn()} />);
    await waitFor(() => expect(calls.some((c) => c.path === '/auth/methods')).toBe(true));
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Recovery code')).toBeTruthy();
    // The password is kept: only the code is missing.
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('correct horse battery');
  });
});

describe('Settings → Passkeys', () => {
  const pk = (id: string, name: string, backedUp = false) => ({
    id,
    name,
    createdAt: '2026-11-01T10:00:00Z',
    lastUsedAt: null,
    backedUp,
  });

  it('lists passkeys, adds the first one and shows its recovery codes once', async () => {
    let items: unknown[] = [];
    routes['GET /auth/passkeys'] = () => ({ json: { items } });
    routes['POST /auth/passkeys/options'] = () => ({ json: options });
    routes['POST /auth/passkeys/verify'] = (b) => {
      items = [pk('k1', (b as { name: string }).name)];
      return {
        status: 201,
        json: { passkey: items[0], recoveryCodes: ['aaaa-bbbb-cccc', 'dddd-eeee-ffff'] },
      };
    };
    const { container } = renderUi(<PasskeysSection />);
    expect(await screen.findByText('No passkeys yet.')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a passkey' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Pixel');
    await userEvent.type(within(dialog).getByLabelText('Your password'), 'correct horse battery');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a passkey' }));

    const codes = await screen.findByRole('dialog', { name: 'Your recovery codes' });
    expect(within(codes).getByText('aaaa-bbbb-cccc')).toBeTruthy();
    expect(calls.find((c) => c.path === '/auth/passkeys/options')!.body).toEqual({
      password: 'correct horse battery',
    });
    expect(calls.find((c) => c.path === '/auth/passkeys/verify')!.body).toEqual({
      ceremonyId: 'c1',
      response: { id: 'cred', response: { attestationObject: 'att' } },
      name: 'Pixel',
    });
    await userEvent.click(within(codes).getByRole('button', { name: 'I have saved them' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Pixel')).toBeTruthy();
  });

  it('a wrong password keeps the dialog open with the server message', async () => {
    routes['GET /auth/passkeys'] = () => ({ json: { items: [] } });
    routes['POST /auth/passkeys/options'] = () => problem(401, 'unauthorized', 'Wrong password.');
    renderUi(<PasskeysSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a passkey' });
    await userEvent.type(within(dialog).getByLabelText('Your password'), 'nope nope nope');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a passkey' }));
    expect(await within(dialog).findByText('Wrong password.')).toBeTruthy();
    expect(browser.create).not.toHaveBeenCalled();
  });

  it('renames and removes a passkey (removing asks for the password)', async () => {
    let items = [pk('k1', 'Pixel', true), pk('k2', 'Laptop')];
    routes['GET /auth/passkeys'] = () => ({ json: { items } });
    routes['PATCH /auth/passkeys/k1'] = (b) => {
      items = [{ ...items[0]!, name: (b as { name: string }).name }, items[1]!];
      return { status: 204 };
    };
    routes['DELETE /auth/passkeys/k2'] = () => {
      items = [items[0]!];
      return { status: 204 };
    };
    renderUi(<PasskeysSection />);
    const pixel = (await screen.findByText('Pixel')).closest('li')!;
    expect(within(pixel).getByText('Synced')).toBeTruthy();

    await userEvent.click(within(pixel).getByRole('button', { name: 'Rename' }));
    const rename = await screen.findByRole('dialog', { name: 'Rename' });
    const field = within(rename).getByLabelText('Name');
    await userEvent.clear(field);
    await userEvent.type(field, 'Phone');
    await userEvent.click(within(rename).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Phone')).toBeTruthy();

    const laptop = screen.getByText('Laptop').closest('li')!;
    await userEvent.click(within(laptop).getByRole('button', { name: 'Remove' }));
    const remove = await screen.findByRole('dialog', { name: 'Remove the passkey “Laptop”?' });
    await userEvent.type(within(remove).getByLabelText('Your password'), 'correct horse battery');
    await userEvent.click(within(remove).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText('Laptop')).toBeNull());
    expect(calls.find((c) => c.method === 'DELETE')!.body).toEqual({ password: 'correct horse battery' });
  });

  it('regenerates the recovery codes', async () => {
    routes['GET /auth/passkeys'] = () => ({ json: { items: [pk('k1', 'Pixel')] } });
    routes['POST /auth/recovery-codes'] = () => ({ json: { codes: ['new1-new2-new3'] } });
    renderUi(<PasskeysSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'New recovery codes' }));
    const dialog = await screen.findByRole('dialog', { name: 'New recovery codes' });
    await userEvent.type(within(dialog).getByLabelText('Your password'), 'correct horse battery');
    await userEvent.click(within(dialog).getByRole('button', { name: 'New recovery codes' }));
    expect(await screen.findByText('new1-new2-new3')).toBeTruthy();
  });

  it('a browser without passkeys says so instead of offering to add one', async () => {
    browser.supported = false;
    routes['GET /auth/passkeys'] = () => ({ json: { items: [] } });
    renderUi(<PasskeysSection />);
    expect(await screen.findByText('This browser cannot use passkeys.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a passkey' })).toBeNull();
  });
});
