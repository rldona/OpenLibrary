import path from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /** Carpeta con todo el estado: library.db, assets/, backups/. */
  DATA_DIR: z.string().default('./.data'),
  /** URL con la que se accede desde los navegadores (p. ej. https://pc.tailnet.ts.net). Se usa para CSRF y cookies. */
  PUBLIC_URL: z.url().default('http://localhost:8080'),
  /** Orígenes extra permitidos para peticiones con cookie (p. ej. el servidor de Vite en desarrollo). */
  EXTRA_ORIGINS: z.string().default(''),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** true si hay un proxy delante (tailscale serve) que fija X-Forwarded-For. */
  TRUST_PROXY: bool,
  /** Carpeta con la web compilada. Si no existe, solo se sirve la API. */
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  publicUrl: URL;
  allowedOrigins: Set<string>;
  secureCookies: boolean;
  sessionTtlMs: number;
  trustProxy: boolean;
  webDist: string | undefined;
  logLevel: string;
  version: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración inválida:\n${z.prettifyError(parsed.error)}`);
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
    publicUrl,
    allowedOrigins: new Set([publicUrl.origin, ...extra]),
    secureCookies: publicUrl.protocol === 'https:',
    sessionTtlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    trustProxy: e.TRUST_PROXY ?? false,
    webDist: e.WEB_DIST ? path.resolve(e.WEB_DIST) : undefined,
    logLevel: e.LOG_LEVEL,
    version: process.env.npm_package_version ?? process.env.OL_VERSION ?? '0.1.0',
  };
}
