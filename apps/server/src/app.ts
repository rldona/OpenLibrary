import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { API_PREFIX, pickLang, type HealthResponse, type Lang, type Problem } from '@openlibrary/contracts';
import type { Config } from './config.js';
import { getMeta, type Db } from './db/client.js';
import { forbidden, HttpError } from './errors.js';
import { tr } from './i18n.js';
import { authRoutes, installSessionHook, SESSION_COOKIE } from './auth/routes.js';
import { AuthService, type Clock } from './auth/service.js';
import { CatalogService } from './catalog/service.js';
import { catalogRoutes } from './catalog/routes.js';
import { AssetService } from './assets/service.js';
import { assetAndLookupRoutes } from './assets/routes.js';
import { LookupService } from './lookup/service.js';
import { SyncService } from './sync/service.js';
import { syncRoutes } from './sync/routes.js';
import type { Fetch } from './lookup/providers.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Language negotiated from Accept-Language (default English). */
    lang: Lang;
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF protection for cookie-authenticated requests:
 * - If the browser sends Origin, it must be one of the allowed origins.
 * - Without Origin but with Sec-Fetch-Site, it must be same-origin.
 * - Clients without browser headers (Android, curl) only pass if they do not use the session cookie.
 * Requests with Authorization: Bearer do not rely on cookies and skip this check.
 */
function checkCsrf(req: FastifyRequest, config: Config): void {
  if (!UNSAFE.has(req.method)) return;
  if (req.headers.authorization?.startsWith('Bearer ')) return;
  const origin = req.headers.origin;
  if (origin) {
    if (!config.allowedOrigins.has(origin)) throw forbidden('errors.originNotAllowed', { origin });
    return;
  }
  const site = req.headers['sec-fetch-site'];
  if (site) {
    if (site !== 'same-origin' && site !== 'none') throw forbidden('errors.crossSite');
    return;
  }
  if (req.cookies[SESSION_COOKIE]) throw forbidden('errors.missingOrigin');
}

function problem(
  lang: Lang,
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
): Problem {
  const t = tr(lang);
  const title = t(`title.${status}`);
  return {
    type: `https://openlibrary.local/problems/${code}`,
    title: title.startsWith('title.') ? 'Error' : title,
    status,
    code,
    detail,
    ...extra,
  };
}

export async function buildApp(deps: {
  config: Config;
  db: Db;
  now?: Clock;
  /** Injectable in tests so they never depend on the Internet. */
  fetch?: Fetch;
}): Promise<FastifyInstance> {
  const { config, db } = deps;
  const auth = new AuthService(db, config.sessionTtlMs, deps.now);
  const catalog = new CatalogService(db, deps.now);
  const assets = new AssetService(db, config.assetsDir, deps.fetch);
  const lookup = new LookupService(db, catalog, deps.fetch, deps.now);
  const sync = new SyncService(db, catalog, deps.now);

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

  app.decorateRequest('lang', 'en');
  app.addHook('onRequest', async (req, reply) => {
    req.lang = pickLang(req.headers['accept-language']);
    reply.header('content-language', req.lang);
    reply.header('vary', 'Accept-Language');
  });

  await app.register(cookie);
  // The sync snapshot of a large library is several MB of JSON: gzip/brotli cut it about tenfold.
  await app.register(compress, { threshold: 1024 });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Preview of covers proposed by providers (they are copied to the server on save).
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
    const t = tr(req.lang);
    let status = 500;
    let code = 'internal';
    let detail = t('errors.unexpected');
    let extra: Record<string, unknown> = {};
    if (err instanceof HttpError) {
      ({ status, code } = err);
      detail = t(err.key, err.params);
      extra = err.extra;
    } else if (typeof (err as { statusCode?: number }).statusCode === 'number') {
      status = (err as { statusCode: number }).statusCode;
      code = status === 429 ? 'rate-limited' : 'http';
      detail = status === 429 ? t('errors.rateLimited') : (err as Error).message;
    }
    if (status >= 500) req.log.error(err);
    if (typeof extra.retryAfterSeconds === 'number')
      reply.header('retry-after', String(extra.retryAfterSeconds));
    return reply
      .code(status)
      .type('application/problem+json')
      .send(problem(req.lang, status, code, detail, extra));
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
      await api.register(syncRoutes, { sync });
    },
    { prefix: API_PREFIX },
  );

  // Built web app (SPA): static files plus index.html fallback for client-side routes.
  const webDist = config.webDist;
  const hasWeb = !!webDist && fs.existsSync(path.join(webDist, 'index.html'));
  if (hasWeb) await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (hasWeb && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    const detail = tr(req.lang)('errors.routeNotFound', {
      method: req.method,
      path: req.url.split('?')[0] ?? '',
    });
    return reply
      .code(404)
      .type('application/problem+json')
      .send(problem(req.lang, 404, 'not-found', detail));
  });

  return app;
}
