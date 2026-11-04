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

/** Extrae el token: Authorization: Bearer (dispositivos) o cookie (web). */
function tokenOf(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  return req.cookies[SESSION_COOKIE];
}

export function requireAuth(req: FastifyRequest): SessionRow {
  if (!req.session) throw unauthorized();
  return req.session;
}

/** Resuelve la sesión de cada petición. Se instala en la raíz para que la vean todos los módulos. */
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

  /** Comprueba contraseña aplicando el bloqueo progresivo por IP. */
  async function verifyWithThrottle(req: FastifyRequest, password: string) {
    if (!auth.isConfigured()) {
      throw new HttpError(
        503,
        'not-configured',
        'La biblioteca aún no tiene contraseña. Ejecuta «ol set-password» en el servidor.',
      );
    }
    const wait = auth.retryAfter(req.ip);
    if (wait > 0) throw tooMany(wait);
    if (!(await auth.checkPassword(password))) {
      auth.recordFailure(req.ip);
      req.log.warn({ ip: req.ip }, 'login fallido');
      const after = auth.retryAfter(req.ip);
      if (after > 0) throw tooMany(after);
      throw unauthorized('Contraseña incorrecta.');
    }
    auth.recordSuccess(req.ip);
  }

  const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.post('/auth/login', strict, async (req, reply: FastifyReply) => {
    const body = parse(LoginRequest, req.body);
    await verifyWithThrottle(req, body.password);
    const s = auth.createSession({
      kind: 'web',
      name: 'Navegador',
      platform: 'web',
      userAgent: req.headers['user-agent'],
    });
    reply.setCookie(SESSION_COOKIE, s.token, { ...cookieOpts, expires: new Date(s.expiresAt!) });
    req.log.info({ session: s.id }, 'login correcto');
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

  /** Alta de un dispositivo (Android): contraseña → token de larga duración que se muestra una vez. */
  app.post('/auth/devices', strict, async (req, reply) => {
    const body = parse(DeviceRegisterRequest, req.body);
    await verifyWithThrottle(req, body.password);
    const s = auth.createSession({
      kind: 'device',
      name: body.name,
      platform: body.platform,
      userAgent: req.headers['user-agent'],
    });
    req.log.info({ session: s.id, name: body.name }, 'dispositivo registrado');
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
    if (!auth.revoke(req.params.id))
      throw notFound('Esa sesión o dispositivo no existe o ya estaba revocado.');
    req.log.info({ session: req.params.id }, 'sesión revocada');
    return reply.code(204).send();
  });

  /** Cambiar contraseña: exige la actual y cierra el resto de sesiones y dispositivos. */
  app.post('/auth/password', strict, async (req, reply) => {
    const me = requireAuth(req);
    const body = parse(ChangePasswordRequest, req.body);
    await verifyWithThrottle(req, body.current);
    await auth.setPassword(body.next, me.id);
    req.log.info('contraseña cambiada; resto de sesiones revocadas');
    return reply.code(204).send();
  });
}
