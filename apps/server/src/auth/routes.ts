import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ChangePasswordRequest,
  DeviceRegisterRequest,
  LoginRequest,
  PasskeyDeviceVerify,
  PasskeyLoginVerify,
  PasskeyRegisterVerify,
  PasskeyRename,
  PasswordConfirm,
  type AuthMethods,
  type CeremonyOptions,
  type Device,
  type DeviceRegisterResponse,
  type PasskeyList,
  type PasskeyRegistered,
  type RecoveryCodes,
  type SessionInfo,
} from '@openlibrary/contracts';
import type { Config } from '../config.js';
import { PasswordGate } from './gate.js';
import { forbidden, HttpError, notFound, parse, tooMany, unauthorized } from '../errors.js';
import { PasskeyError, type PasskeyService } from './passkeys.js';
import { throttleKey } from './throttleKey.js';
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

export async function authRoutes(
  app: FastifyInstance,
  opts: { auth: AuthService; passkeys: PasskeyService; config: Config },
) {
  const { auth, passkeys, config } = opts;

  const cookieOpts = {
    path: '/',
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict' as const,
  };

  const gate = new PasswordGate();

  /**
   * Checks the password through the per-address lockout and the admission gate (keyed by
   * `throttleKey`: an IPv6 client counts as its /64; bounded concurrency,
   * known addresses first). Returns whether it is right and records nothing: the caller decides what
   * counts as a success, so a right password never clears failures on its own.
   */
  async function checkThrottled(req: FastifyRequest, password: string): Promise<boolean> {
    if (!auth.isConfigured()) throw new HttpError(503, 'not-configured', 'errors.notConfigured');
    const who = throttleKey(req.clientIp);
    const wait = auth.retryAfter(who);
    if (wait > 0) throw tooMany(wait);
    const ok = await gate.run(who, auth.isKnown(who), () => auth.checkPassword(password));
    if (ok === 'busy-address') throw tooMany(1);
    if (ok === 'busy-queue') {
      req.log.warn({ ip: req.clientIp, waiting: gate.waiting }, 'password checks queue full');
      throw new HttpError(429, 'rate-limited', 'errors.rateLimited', {}, { retryAfterSeconds: 2 });
    }
    return ok;
  }

  /** A failed sign-in: one more failure for the address, then 429 (locked) or 401 with `key`. */
  function failSignIn(req: FastifyRequest, key: string, reason: string): never {
    const ip = req.clientIp;
    const who = throttleKey(ip);
    auth.recordFailure(who);
    req.log.warn({ ip, reason }, 'failed login');
    // At debug level, the raw forwarding headers: to check the TRUST_PROXY setting on a new host.
    req.log.debug(
      {
        socket: req.socket.remoteAddress,
        xForwardedFor: req.headers['x-forwarded-for'],
        xRealIp: req.headers['x-real-ip'],
      },
      'failed login: proxy headers',
    );
    const after = auth.retryAfter(who);
    if (after > 0) throw tooMany(after);
    throw unauthorized(key);
  }

  /** Password only (no passkeys, or confirming a sensitive action): success clears the address. */
  async function verifyWithThrottle(req: FastifyRequest, password: string) {
    if (!(await checkThrottled(req, password))) failSignIn(req, 'errors.wrongPassword', 'password');
    auth.recordSuccess(throttleKey(req.clientIp));
  }

  /**
   * Password sign-in (web login, device registration). With no passkey, the password is enough.
   * Once a passkey exists it is refused on its own (`passkey-required`, before the password is even
   * checked, so it reveals nothing) and accepted only with an unused recovery code, which it consumes.
   * A wrong password and a wrong code are one failure each, with the same answer; only both right
   * count as a success (clearing the address's failures and making it known). Otherwise a right
   * password would reset the counter and reveal itself through the lockout.
   */
  async function passwordSignIn(req: FastifyRequest, password: string, recoveryCode: string | undefined) {
    if (!auth.isConfigured()) throw new HttpError(503, 'not-configured', 'errors.notConfigured');
    if (!passkeys.hasAny()) return verifyWithThrottle(req, password);
    if (!recoveryCode) throw new HttpError(403, 'passkey-required', 'errors.passkeyRequired');
    // The code is consumed only when the password is right.
    if (!(await checkThrottled(req, password)) || !passkeys.useCode(recoveryCode)) {
      failSignIn(req, 'errors.wrongPasswordOrCode', 'password or recovery code');
    }
    auth.recordSuccess(throttleKey(req.clientIp));
    req.log.warn({ ip: req.clientIp, remaining: passkeys.remainingCodes() }, 'recovery code used');
  }

  /** Checks a passkey sign-in; a failed one counts for the per-address lockout like a wrong password. */
  async function passkeySignIn(req: FastifyRequest, ceremonyId: string, response: unknown) {
    if (!auth.isConfigured()) throw new HttpError(503, 'not-configured', 'errors.notConfigured');
    const ip = req.clientIp;
    const who = throttleKey(ip);
    const wait = auth.retryAfter(who);
    if (wait > 0) throw tooMany(wait);
    try {
      const key = await passkeys.verifyAuthentication(ceremonyId, response);
      auth.recordSuccess(who);
      return key;
    } catch (e) {
      if (!(e instanceof PasskeyError)) throw e;
      auth.recordFailure(who);
      req.log.warn({ ip, reason: e.message }, 'failed passkey sign-in');
      const after = auth.retryAfter(who);
      if (after > 0) throw tooMany(after);
      throw unauthorized('errors.passkeyFailed');
    }
  }

  const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  /** Opens a web session (cookie) after a successful sign-in. */
  function webSession(req: FastifyRequest, reply: FastifyReply, via: string): SessionInfo {
    // The name is a neutral identifier: clients render "Browser"/"Navegador" for web sessions.
    const s = auth.createSession({
      kind: 'web',
      name: 'Browser',
      platform: 'web',
      userAgent: req.headers['user-agent'],
    });
    reply.setCookie(SESSION_COOKIE, s.token, { ...cookieOpts, expires: new Date(s.expiresAt!) });
    req.log.info({ session: s.id, via }, 'login ok');
    return { authenticated: true, kind: 'web', sessionId: s.id, expiresAt: s.expiresAt };
  }

  /** Registers a device (long-lived token shown only once). */
  function deviceSession(
    req: FastifyRequest,
    reply: FastifyReply,
    name: string,
    platform: string,
    via: string,
  ): DeviceRegisterResponse {
    const s = auth.createSession({ kind: 'device', name, platform, userAgent: req.headers['user-agent'] });
    req.log.info({ session: s.id, name, via }, 'device registered');
    reply.code(201);
    return { deviceId: s.id, token: s.token };
  }

  app.get('/auth/methods', async (): Promise<AuthMethods> => ({
    passwordConfigured: auth.isConfigured(),
    passkeys: passkeys.hasAny(),
  }));

  app.post('/auth/login', strict, async (req, reply: FastifyReply) => {
    const body = parse(LoginRequest, req.body, req.lang);
    await passwordSignIn(req, body.password, body.recoveryCode);
    return webSession(req, reply, 'password');
  });

  // ---------- Passkey sign-in (web session or device token) ----------
  app.post('/auth/login/passkey/options', strict, async (): Promise<CeremonyOptions> => {
    if (!auth.isConfigured()) throw new HttpError(503, 'not-configured', 'errors.notConfigured');
    return passkeys.authenticationOptions();
  });

  app.post('/auth/login/passkey/verify', strict, async (req, reply) => {
    const body = parse(PasskeyLoginVerify, req.body, req.lang);
    await passkeySignIn(req, body.ceremonyId, body.response);
    return webSession(req, reply, 'passkey');
  });

  /** Android setup with a passkey: same options endpoint as the web sign-in. */
  app.post('/auth/devices/passkey', strict, async (req, reply) => {
    const body = parse(PasskeyDeviceVerify, req.body, req.lang);
    await passkeySignIn(req, body.ceremonyId, body.response);
    return deviceSession(req, reply, body.name, body.platform, 'passkey');
  });

  // ---------- Passkey management (session; adding or removing also needs the password) ----------
  app.get('/auth/passkeys', async (req): Promise<PasskeyList> => {
    requireAuth(req);
    return { items: passkeys.list() };
  });

  app.post('/auth/passkeys/options', strict, async (req): Promise<CeremonyOptions> => {
    const me = requireAuth(req);
    const body = parse(PasswordConfirm, req.body, req.lang);
    await verifyWithThrottle(req, body.password);
    return passkeys.registrationOptions(me.id);
  });

  app.post('/auth/passkeys/verify', strict, async (req, reply): Promise<PasskeyRegistered> => {
    const me = requireAuth(req);
    const body = parse(PasskeyRegisterVerify, req.body, req.lang);
    try {
      const r = await passkeys.verifyRegistration(body.ceremonyId, me.id, body.response, body.name);
      req.log.info({ passkey: r.passkey.id, first: !!r.recoveryCodes }, 'passkey registered');
      reply.code(201);
      return r;
    } catch (e) {
      if (!(e instanceof PasskeyError)) throw e;
      req.log.warn({ reason: e.message }, 'passkey registration failed');
      throw forbidden('errors.passkeyFailed');
    }
  });

  app.patch<{ Params: { id: string } }>('/auth/passkeys/:id', async (req, reply) => {
    requireAuth(req);
    const body = parse(PasskeyRename, req.body, req.lang);
    if (!passkeys.rename(req.params.id, body.name)) throw notFound('errors.passkeyNotFound');
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>('/auth/passkeys/:id', strict, async (req, reply) => {
    requireAuth(req);
    const body = parse(PasswordConfirm, req.body, req.lang);
    await verifyWithThrottle(req, body.password);
    if (!passkeys.remove(req.params.id)) throw notFound('errors.passkeyNotFound');
    req.log.info({ passkey: req.params.id, left: passkeys.list().length }, 'passkey removed');
    return reply.code(204).send();
  });

  app.post('/auth/recovery-codes', strict, async (req): Promise<RecoveryCodes> => {
    requireAuth(req);
    const body = parse(PasswordConfirm, req.body, req.lang);
    await verifyWithThrottle(req, body.password);
    if (!passkeys.hasAny()) throw new HttpError(409, 'no-passkeys', 'errors.passkeyNotFound');
    req.log.info('recovery codes regenerated');
    return { codes: passkeys.regenerateCodes() };
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

  /** Device registration (Android): password (+ recovery code once passkeys exist) → long-lived token. */
  app.post('/auth/devices', strict, async (req, reply) => {
    const body = parse(DeviceRegisterRequest, req.body, req.lang);
    await passwordSignIn(req, body.password, body.recoveryCode);
    return deviceSession(req, reply, body.name, body.platform, 'password');
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
