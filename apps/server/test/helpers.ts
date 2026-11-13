import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/client.js';
import { AuthService } from '../src/auth/service.js';
import type { Fetch } from '../src/lookup/providers.js';

export const PASSWORD = 'correct horse battery staple';
export const ORIGIN = 'https://biblioteca.test';

/** In-memory app with a controllable clock and a temporary data folder. */
export async function makeApp(
  opts: { configured?: boolean; env?: Record<string, string>; fetch?: Fetch } = {},
) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-app-'));
  const config = loadConfig({ NODE_ENV: 'test', PUBLIC_URL: ORIGIN, DATA_DIR: dataDir, ...opts.env });
  const db = openDb(':memory:');
  const clock = { t: new Date('2026-11-04T10:00:00Z') };
  const now = () => new Date(clock.t);
  if (opts.configured !== false) await new AuthService(db, config.sessionTtlMs, now).setPassword(PASSWORD);
  const app = await buildApp({ config, db, now, fetch: opts.fetch ?? noNetwork });
  const advance = (ms: number) => {
    clock.t = new Date(clock.t.getTime() + ms);
  };
  return { app, db, config, advance, dataDir };
}

/** By default tests have no Internet access. */
export const noNetwork: Fetch = async () => {
  throw new Error('no network in tests');
};

export const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.find((c) => c.name === 'ol_session')?.value;

type App = Awaited<ReturnType<typeof makeApp>>['app'];

/** Client authenticated like the web app (cookie + Origin). */
export async function webClient(app: App) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: ORIGIN },
    payload: { password: PASSWORD },
  });
  const token = cookieOf(res)!;
  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => {
    const r = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { origin: ORIGIN },
      cookies: { ol_session: token },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return { status: r.statusCode, body: r.body ? (r.json() as any) : undefined, raw: r }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return {
    token,
    get: (u: string) => call('GET', u),
    post: (u: string, b?: unknown) => call('POST', u, b ?? {}),
    put: (u: string, b: unknown) => call('PUT', u, b),
    patch: (u: string, b: unknown) => call('PATCH', u, b),
    del: (u: string) => call('DELETE', u),
  };
}
