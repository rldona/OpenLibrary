import path from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /** Folder holding all state: library.db, assets/, backups/. */
  DATA_DIR: z.string().default('./.data'),
  /** URL browsers use to reach the app (e.g. https://library.example.com). Used for CSRF and cookies. */
  PUBLIC_URL: z.url().default('http://localhost:8080'),
  /** Extra origins allowed for cookie requests (e.g. the Vite dev server). */
  EXTRA_ORIGINS: z.string().default(''),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /**
   * How to find the client address behind a reverse proxy (it drives the login lockout and the
   * rate limit, so it must not be spoofable):
   *   false / 0 (default)  no proxy: the socket address.
   *   true                 trust every X-Forwarded-For entry (left-most); only when every
   *                        client's request goes through a proxy that strips it.
   *   <n> (1, 2…)          trust the last n hops of X-Forwarded-For: the address added by the
   *                        proxy in front; anything the client wrote before it is ignored.
   *   <header name>        a header the proxy always overwrites with the client address, such
   *                        as x-real-ip on Railway's edge.
   */
  TRUST_PROXY: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(true|false|\d{1,2}|[a-z][a-z0-9-]*)$/, 'true, false, a hop count or a header name')
    .optional(),
  /** Folder with the built web app. If missing, only the API is served. */
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /**
   * Optional free Google Books API key. Without it, requests share Google's anonymous daily quota,
   * which is often exhausted (HTTP 429) and leaves only Open Library.
   */
  GOOGLE_BOOKS_API_KEY: z.string().trim().optional(),
});

/** Parsed TRUST_PROXY: Fastify's own setting, or a header the proxy sets with the client address. */
export type TrustProxy = boolean | number | { header: string };

export function parseTrustProxy(v: string | undefined): TrustProxy {
  if (v === undefined || v === 'false' || v === '0') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return { header: v };
}

export type Config = {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  assetsDir: string;
  publicUrl: URL;
  allowedOrigins: Set<string>;
  secureCookies: boolean;
  sessionTtlMs: number;
  trustProxy: TrustProxy;
  webDist: string | undefined;
  logLevel: string;
  googleBooksKey: string | undefined;
  version: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const publicUrl = new URL(e.PUBLIC_URL);
  const dataDir = path.resolve(e.DATA_DIR);
  const extra = e.EXTRA_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new URL(s).origin);
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    dataDir,
    dbPath: path.join(dataDir, 'library.db'),
    assetsDir: path.join(dataDir, 'assets'),
    publicUrl,
    allowedOrigins: new Set([publicUrl.origin, ...extra]),
    secureCookies: publicUrl.protocol === 'https:',
    sessionTtlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    webDist: e.WEB_DIST ? path.resolve(e.WEB_DIST) : undefined,
    logLevel: e.LOG_LEVEL,
    googleBooksKey: e.GOOGLE_BOOKS_API_KEY || undefined,
    version: process.env.npm_package_version ?? process.env.OL_VERSION ?? '0.1.0',
  };
}
