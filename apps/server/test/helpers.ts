import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/client.js';
import { AuthService } from '../src/auth/service.js';

export const PASSWORD = 'correct horse battery staple';
export const ORIGIN = 'https://biblioteca.test';

/** App en memoria con reloj controlable. */
export async function makeApp(opts: { configured?: boolean; env?: Record<string, string> } = {}) {
  const config = loadConfig({ NODE_ENV: 'test', PUBLIC_URL: ORIGIN, DATA_DIR: '/tmp/unused', ...opts.env });
  const db = openDb(':memory:');
  const clock = { t: new Date('2026-11-04T10:00:00Z') };
  const now = () => new Date(clock.t);
  if (opts.configured !== false) await new AuthService(db, config.sessionTtlMs, now).setPassword(PASSWORD);
  const app = await buildApp({ config, db, now });
  const advance = (ms: number) => {
    clock.t = new Date(clock.t.getTime() + ms);
  };
  return { app, db, config, advance };
}

export const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.find((c) => c.name === 'ol_session')?.value;
