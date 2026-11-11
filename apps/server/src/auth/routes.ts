import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ChangePasswordRequest,
  DeviceRegisterRequest,
  LoginRequest,
  type Device,
  type DeviceRegisterResponse,
  type SessionInfo,
} from '@openlibrary/contracts';
import type { Config } from '../config.js';
import { HttpError, notFound, parse, tooMany, unauthorized } from '../errors.js';
import type { AuthService, SessionRow } from './service.js';

export const SESSION_COOKIE = 'ol_session';

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionRow | null;
  }
}

/** Extracts the token: Authorization: Bearer (devices) or cookie (web). */
function tokenOf(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  return req.cookies[SESSION_COOKIE];
}

export function requireAuth(req: FastifyRequest): SessionRow {
  if (!req.session) throw unauthorized();
  return req.session;
}

/** Resolves the session of every request. Installed at the root so every module sees it. */
export function installSessionHook(app: FastifyInstance, auth: AuthService): void {
  app.decorateRequest('session', null);
  app.addHook('onRequest', async (req) => {
    req.session = auth.authenticate(tokenOf(req));
  });
}

export async function authRoutes(app: FastifyInstance, opts: { auth: AuthService; config: Config }) {
  const { auth, config } = opts;

  const cookieOpts = {
    path: '/',
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict' as const,
  };

  /** Checks the password, applying the progressive per-IP lockout. */
  async function verifyWithThrottle(req: FastifyRequest, password: string) {
    if (!auth.isConfigured()) throw new HttpError(503, 'not-configured', 'errors.notConfigured');
    const ip = req.clientIp;
    const wait = auth.retryAfter(ip);
    if (wait > 0) throw tooMany(wait);
    if (!(await auth.checkPassword(password))) {
      auth.recordFailure(ip);
      req.log.warn({ ip }, 'failed login');
      // At debug level, the raw forwarding headers: to check the TRUST_PROXY setting on a new host.
      req.log.debug(
        {
          socket: req.socket.remoteAddress,
          xForwardedFor: req.headers['x-forwarded-for'],
          xRealIp: req.headers['x-real-ip'],
        },
        'failed login: proxy headers',
      );
      const after = auth.retryAfter(ip);
      if (after > 0) throw tooMany(after);
      throw unauthorized('errors.wrongPassword');
    }
    auth.recordSuccess(ip);
  }

  const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.post('/auth/login', strict, async (req, reply: FastifyReply) => {
    const body = parse(LoginRequest, req.body, req.lang);
    await verifyWithThrottle(req, body.password);
    // The name is a neutral identifier: clients render "Browser"/"Navegador" for web sessions.
    const s = auth.createSession({
      kind: 'web',
      name: 'Browser',
      platform: 'web',
      userAgent: req.headers['user-agent'],
    });
    reply.setCookie(SESSION_COOKIE, s.token, { ...cookieOpts, expires: new Date(s.expiresAt!) });
    req.log.info({ session: s.id }, 'login ok');
    return {
      authenticated: true,
      kind: 'web',
      sessionId: s.id,
      expiresAt: s.expiresAt,
    } satisfies SessionInfo;
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.session) auth.revoke(req.session.id);
    reply.clearCookie(SESSION_COOKIE, cookieOpts);
    return reply.code(204).send();
  });

  app.get('/auth/me', async (req) => {
    const s = requireAuth(req);
    return {
      authenticated: true,
      kind: s.kind,
      sessionId: s.id,
      expiresAt: s.expiresAt,
    } satisfies SessionInfo;
  });

  /** Device registration (Android): password → long-lived token shown only once. */
  app.post('/auth/devices', strict, async (req, reply) => {
    const body = parse(DeviceRegisterRequest, req.body, req.lang);
    await verifyWithThrottle(req, body.password);
    const s = auth.createSession({
      kind: 'device',
      name: body.name,
      platform: body.platform,
      userAgent: req.headers['user-agent'],
    });
    req.log.info({ session: s.id, name: body.name }, 'device registered');
    reply.code(201);
    return { deviceId: s.id, token: s.token } satisfies DeviceRegisterResponse;
  });

  app.get('/auth/devices', async (req) => {
    const me = requireAuth(req);
    const items: Device[] = auth.listActive().map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name,
      platform: s.platform,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      current: s.id === me.id,
    }));
    return { items };
  });

  app.delete<{ Params: { id: string } }>('/auth/devices/:id', async (req, reply) => {
    requireAuth(req);
    if (!auth.revoke(req.params.id)) throw notFound('errors.sessionNotFound');
    req.log.info({ session: req.params.id }, 'session revoked');
    return reply.code(204).send();
  });

  /** Change password: requires the current one and signs out every other session and device. */
  app.post('/auth/password', strict, async (req, reply) => {
    const me = requireAuth(req);
    const body = parse(ChangePasswordRequest, req.body, req.lang);
    await verifyWithThrottle(req, body.current);
    await auth.setPassword(body.next, me.id);
    req.log.info('password changed; other sessions revoked');
    return reply.code(204).send();
  });
}
