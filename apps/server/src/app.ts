import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { API_PREFIX, type HealthResponse, type Problem } from '@openlibrary/contracts';
import type { Config } from './config.js';
import { getMeta, type Db } from './db/client.js';
import { forbidden, HttpError, TITLES } from './errors.js';
import { authRoutes, installSessionHook, SESSION_COOKIE } from './auth/routes.js';
import { AuthService, type Clock } from './auth/service.js';
import { CatalogService } from './catalog/service.js';
import { catalogRoutes } from './catalog/routes.js';
import { AssetService } from './assets/service.js';
import { assetAndLookupRoutes } from './assets/routes.js';
import { LookupService } from './lookup/service.js';
import type { Fetch } from './lookup/providers.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Protección CSRF para peticiones con cookie:
 * - Si el navegador envía Origin, debe ser uno de los permitidos.
 * - Si no hay Origin pero sí Sec-Fetch-Site, debe ser same-origin.
 * - Clientes sin cabeceras de navegador (Android, curl) solo pasan si no usan cookie de sesión.
 * Las peticiones con Authorization: Bearer no dependen de cookies y no necesitan esta comprobación.
 */
function checkCsrf(req: FastifyRequest, config: Config): void {
  if (!UNSAFE.has(req.method)) return;
  if (req.headers.authorization?.startsWith('Bearer ')) return;
  const origin = req.headers.origin;
  if (origin) {
    if (!config.allowedOrigins.has(origin)) throw forbidden(`Origen no permitido: ${origin}`);
    return;
  }
  const site = req.headers['sec-fetch-site'];
  if (site) {
    if (site !== 'same-origin' && site !== 'none') throw forbidden('Petición entre sitios bloqueada.');
    return;
  }
  if (req.cookies[SESSION_COOKIE]) throw forbidden('Falta la cabecera Origin.');
}

export async function buildApp(deps: {
  config: Config;
  db: Db;
  now?: Clock;
  /** Inyectable en pruebas para no depender de Internet. */
  fetch?: Fetch;
}): Promise<FastifyInstance> {
  const { config, db } = deps;
  const auth = new AuthService(db, config.sessionTtlMs, deps.now);
  const catalog = new CatalogService(db, deps.now);
  const assets = new AssetService(db, config.assetsDir, deps.fetch);
  const lookup = new LookupService(db, catalog, deps.fetch, deps.now);

  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    logger:
      config.env === 'test'
        ? false
        : {
            level: config.logLevel,
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          },
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Vista previa de portadas propuestas por los proveedores (al guardar se copian al servidor).
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://covers.openlibrary.org',
          'https://archive.org',
          'https://*.archive.org',
          'https://books.google.com',
          'https://*.googleusercontent.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.secureCookies ? [] : null,
      },
    },
    hsts: config.secureCookies ? { maxAge: 31536000 } : false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });

  installSessionHook(app, auth);
  app.addHook('preHandler', async (req) => checkCsrf(req, config));

  app.setErrorHandler((err, req, reply) => {
    let status = 500;
    let code = 'internal';
    let detail = 'Error inesperado.';
    let extra: Record<string, unknown> = {};
    if (err instanceof HttpError) {
      ({ status, code } = err);
      detail = err.message;
      extra = err.extra;
    } else if (typeof (err as { statusCode?: number }).statusCode === 'number') {
      status = (err as { statusCode: number }).statusCode;
      code = status === 429 ? 'rate-limited' : 'http';
      detail = (err as Error).message;
    }
    if (status >= 500) req.log.error(err);
    if (typeof extra.retryAfterSeconds === 'number')
      reply.header('retry-after', String(extra.retryAfterSeconds));
    const body: Problem = {
      type: `https://openlibrary.local/problems/${code}`,
      title: TITLES[status] ?? 'Error',
      status,
      detail,
      ...extra,
    };
    return reply.code(status).type('application/problem+json').send(body);
  });

  await app.register(
    async (api) => {
      api.get('/health', async () => {
        const body: HealthResponse = {
          status: 'ok',
          version: config.version,
          epoch: getMeta(db, 'epoch') ?? '',
          time: new Date().toISOString(),
        };
        return body;
      });
      await api.register(authRoutes, { auth, config });
      await api.register(catalogRoutes, { catalog });
      await api.register(assetAndLookupRoutes, { assets, lookup });
    },
    { prefix: API_PREFIX },
  );

  // Web compilada (SPA): archivos estáticos y fallback a index.html para las rutas del cliente.
  const webDist = config.webDist;
  const hasWeb = !!webDist && fs.existsSync(path.join(webDist, 'index.html'));
  if (hasWeb) await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (hasWeb && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    const body: Problem = {
      type: 'https://openlibrary.local/problems/not-found',
      title: TITLES[404]!,
      status: 404,
      detail: `No existe ${req.method} ${req.url.split('?')[0]}`,
    };
    return reply.code(404).type('application/problem+json').send(body);
  });

  return app;
}
