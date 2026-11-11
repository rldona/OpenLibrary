import { describe, expect, it } from 'vitest';
import { loadConfig, parseTrustProxy } from '../src/config.js';
import { openDb } from '../src/db/client.js';
import { authFailures } from '../src/db/schema.js';
import { AuthService, THROTTLE } from '../src/auth/service.js';
import { throttleKey } from '../src/auth/throttleKey.js';
import { cookieOf, makeApp, ORIGIN, PASSWORD } from './helpers.js';

const login = (app: Awaited<ReturnType<typeof makeApp>>['app'], password: string, ip = '10.0.0.1') =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: ORIGIN },
    remoteAddress: ip,
    payload: { password },
  });

describe('system', () => {
  it('health answers without auth and includes the epoch', async () => {
    const { app } = await makeApp();
    const res = await app.inject('/api/v1/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', epoch: expect.any(String) });
  });

  it('health reports OL_VERSION (the deployed commit) as the version', async () => {
    const { app } = await makeApp({ env: { OL_VERSION: 'abc123def456' } });
    expect((await app.inject('/api/v1/health')).json().version).toBe('abc123def456');
  });

  it('unknown routes return problem+json', async () => {
    const { app } = await makeApp();
    const res = await app.inject('/api/v1/nada');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('sends security headers', async () => {
    const { app } = await makeApp();
    const res = await app.inject('/api/v1/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('web login', () => {
  it('without a password it answers 503 with instructions', async () => {
    const { app } = await makeApp({ configured: false });
    const res = await login(app, 'loquesea');
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).toContain('set-password');
  });

  it('right password creates a secure cookie and /me works', async () => {
    const { app } = await makeApp();
    const res = await login(app, PASSWORD);
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === 'ol_session')!;
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    const me = await app.inject({ url: '/api/v1/auth/me', cookies: { ol_session: c.value } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ authenticated: true, kind: 'web' });
  });

  it('wrong password: 401 and no cookie', async () => {
    const { app } = await makeApp();
    const res = await login(app, 'nope');
    expect(res.statusCode).toBe(401);
    expect(cookieOf(res)).toBeUndefined();
  });

  it('/me without a session is 401', async () => {
    const { app } = await makeApp();
    expect((await app.inject('/api/v1/auth/me')).statusCode).toBe(401);
  });

  it('logout revokes the session', async () => {
    const { app } = await makeApp();
    const token = cookieOf(await login(app, PASSWORD))!;
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: ORIGIN },
      cookies: { ol_session: token },
    });
    expect(out.statusCode).toBe(204);
    const me = await app.inject({ url: '/api/v1/auth/me', cookies: { ol_session: token } });
    expect(me.statusCode).toBe(401);
  });

  it('a web session expires if unused for the TTL', async () => {
    const { app, advance } = await makeApp({ env: { SESSION_TTL_DAYS: '1' } });
    const token = cookieOf(await login(app, PASSWORD))!;
    advance(25 * 60 * 60 * 1000);
    expect((await app.inject({ url: '/api/v1/auth/me', cookies: { ol_session: token } })).statusCode).toBe(
      401,
    );
  });

  it('expiry slides while the session is in use', async () => {
    const { app, advance } = await makeApp({ env: { SESSION_TTL_DAYS: '1' } });
    const token = cookieOf(await login(app, PASSWORD))!;
    for (let i = 0; i < 4; i++) {
      advance(20 * 60 * 60 * 1000);
      expect((await app.inject({ url: '/api/v1/auth/me', cookies: { ol_session: token } })).statusCode).toBe(
        200,
      );
    }
  });
});

describe('brute force', () => {
  it('locks an IP after 5 failures and doubles the wait', async () => {
    const { app, advance } = await makeApp();
    for (let i = 0; i < 4; i++) expect((await login(app, 'mal')).statusCode).toBe(401);
    const fifth = await login(app, 'mal');
    expect(fifth.statusCode).toBe(429);
    expect(fifth.headers['retry-after']).toBe('60');
    // Locked: not even the right password gets through.
    expect((await login(app, PASSWORD)).statusCode).toBe(429);
    // Another IP is not affected.
    expect((await login(app, PASSWORD, '10.0.0.2')).statusCode).toBe(200);
    advance(61_000);
    const sixth = await login(app, 'mal');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.headers['retry-after']).toBe('120');
    advance(121_000);
    expect((await login(app, PASSWORD)).statusCode).toBe(200);
    // Success resets the counter.
    expect((await login(app, 'mal')).statusCode).toBe(401);
  });
});

describe('strangers cannot lock the owner out', () => {
  const service = () => {
    const db = openDb(':memory:');
    const clock = { t: new Date('2026-11-04T10:00:00Z').getTime() };
    const auth = new AuthService(db, 1000, () => new Date(clock.t));
    return { db, auth, advance: (ms: number) => (clock.t += ms) };
  };
  const keys = (db: ReturnType<typeof openDb>) =>
    db
      .select({ key: authFailures.key })
      .from(authFailures)
      .all()
      .map((r) => r.key)
      .sort();

  it('1,000 failures from many addresses do not lock another address', () => {
    const { auth } = service();
    for (let i = 0; i < 1000; i++) auth.recordFailure(`198.51.${i >> 8}.${i & 255}`);
    expect(auth.retryAfter('192.0.2.10')).toBe(0);
  });

  it('over HTTP: during a burst from many addresses the owner still signs in, ahead of the queue', async () => {
    const { app } = await makeApp();
    expect((await login(app, PASSWORD, '192.0.2.10')).statusCode).toBe(200);
    // More than the old global limit (100 per hour), all at the same time, plus the owner. The order
    // in which they finish is checked, not the wall clock (slow or busy CI machines).
    const finished: string[] = [];
    const burst = Array.from({ length: 150 }, (_, i) =>
      login(app, 'mal', `198.51.100.${i}`).then((r) => {
        finished.push(String(r.statusCode));
        return r;
      }),
    );
    const owner = await login(app, PASSWORD, '192.0.2.10').then((r) => {
      finished.push('owner');
      return r;
    });
    const statuses = (await Promise.all(burst)).map((r) => r.statusCode);
    expect(owner.statusCode).toBe(200);
    // Known address: admitted ahead of the up to 64 waiting checks. Only the checks already running
    // (and a few that started before the owner's request reached the gate) finish before it.
    const checkedBefore = finished.slice(0, finished.indexOf('owner')).filter((s) => s === '401').length;
    expect(checkedBefore).toBeLessThan(16);
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThan(checkedBefore + 16);
    // Beyond the queue, strangers are turned away for a moment instead of piling up.
    expect(new Set(statuses)).toEqual(new Set([401, 429]));
    // After the burst nothing is locked: the owner signs in from a new address.
    expect((await login(app, PASSWORD, '192.0.2.77')).statusCode).toBe(200);
  });

  it('forgets an address one day after its last failure, and known addresses after 30 days', () => {
    const { db, auth, advance } = service();
    auth.recordFailure('203.0.113.1');
    auth.recordSuccess('192.0.2.10');
    advance(THROTTLE.forgetAfterMs - 1000);
    auth.recordFailure('203.0.113.2');
    expect(keys(db)).toEqual(['ip:203.0.113.1', 'ip:203.0.113.2', 'ok:192.0.2.10']);
    advance(2000);
    auth.recordFailure('203.0.113.3');
    expect(keys(db)).toEqual(['ip:203.0.113.2', 'ip:203.0.113.3', 'ok:192.0.2.10']);
    expect(auth.isKnown('192.0.2.10')).toBe(true);
    advance(THROTTLE.knownForMs);
    auth.prune();
    expect(keys(db)).toEqual([]);
    expect(auth.isKnown('192.0.2.10')).toBe(false);
  });

  it('a persistent address keeps doubling its wait instead of starting over', () => {
    const { auth, advance } = service();
    const ip = '203.0.113.9';
    for (let i = 0; i < 5; i++) auth.recordFailure(ip);
    let wait = auth.retryAfter(ip);
    expect(wait).toBe(60);
    for (const expected of [120, 240, 480, 960, 1920, 3600, 3600]) {
      advance(wait * 1000);
      auth.recordFailure(ip);
      wait = auth.retryAfter(ip);
      expect(wait).toBe(expected);
    }
  });
});

describe('client address behind a proxy', () => {
  type App = Awaited<ReturnType<typeof makeApp>>['app'];
  /** A request as the proxy forwards it: the socket is always the proxy itself. */
  const viaProxy = (app: App, password: string, headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN, ...headers },
      remoteAddress: '100.64.0.2',
      payload: { password },
    });
  const lockOut = async (app: App, headers: (i: number) => Record<string, string>) => {
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await viaProxy(app, 'mal', headers(i))).statusCode;
    return last;
  };

  it('parses TRUST_PROXY', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('x-real-ip')).toEqual({ header: 'x-real-ip' });
    expect(() => loadConfig({ TRUST_PROXY: 'x real ip' })).toThrow(/TRUST_PROXY/);
  });

  it('header mode (Railway: x-real-ip): a forged X-Forwarded-For does not change the lockout key', async () => {
    const { app } = await makeApp({ env: { TRUST_PROXY: 'x-real-ip' } });
    const attacker = (i: number) => ({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': `198.51.100.${i}` });
    expect(await lockOut(app, attacker)).toBe(429);
    expect((await viaProxy(app, PASSWORD, attacker(99))).statusCode).toBe(429);
    // Another real client is not affected.
    expect((await viaProxy(app, PASSWORD, { 'x-real-ip': '192.0.2.10' })).statusCode).toBe(200);
  });

  it('header mode: two real clients get independent lockouts', async () => {
    const { app } = await makeApp({ env: { TRUST_PROXY: 'x-real-ip' } });
    expect(await lockOut(app, () => ({ 'x-real-ip': '203.0.113.7' }))).toBe(429);
    expect(await lockOut(app, () => ({ 'x-real-ip': '203.0.113.8' }))).toBe(429);
    expect((await viaProxy(app, PASSWORD, { 'x-real-ip': '192.0.2.10' })).statusCode).toBe(200);
  });

  it('hop mode: only the address added by the proxy counts', async () => {
    const { app } = await makeApp({ env: { TRUST_PROXY: '1' } });
    // The client writes its own X-Forwarded-For; the proxy appends the real address.
    const attacker = (i: number) => ({ 'x-forwarded-for': `198.51.100.${i}, 203.0.113.7` });
    expect(await lockOut(app, attacker)).toBe(429);
    expect((await viaProxy(app, PASSWORD, attacker(42))).statusCode).toBe(429);
    expect((await viaProxy(app, PASSWORD, { 'x-forwarded-for': '192.0.2.10' })).statusCode).toBe(200);
  });

  it('without TRUST_PROXY, forwarding headers are ignored', async () => {
    const { app } = await makeApp();
    expect(
      await lockOut(app, (i) => ({ 'x-forwarded-for': `198.51.100.${i}`, 'x-real-ip': `198.51.100.${i}` })),
    ).toBe(429);
    expect((await viaProxy(app, PASSWORD, { 'x-real-ip': '192.0.2.10' })).statusCode).toBe(429);
  });
});

describe('IPv6 clients count as their /64', () => {
  type App = Awaited<ReturnType<typeof makeApp>>['app'];
  const from = (app: App, ip: string, password: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN, 'x-real-ip': ip },
      remoteAddress: '100.64.0.2',
      payload: { password },
    });

  it('addresses in the same /64 share one lockout; another /64 does not', async () => {
    const { app } = await makeApp({ env: { TRUST_PROXY: 'x-real-ip' } });
    const statuses: number[] = [];
    // A new address of the same /64 for every attempt.
    for (let i = 1; i <= 5; i++) statuses.push((await from(app, `2001:db8:1:2::${i}`, 'mal')).statusCode);
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    expect((await from(app, '2001:db8:1:2:ffff:ffff:ffff:ffff', PASSWORD)).statusCode).toBe(429);
    expect((await from(app, '2001:db8:1:3::1', PASSWORD)).statusCode).toBe(200);
  });

  it('IPv4 and IPv4-mapped IPv6 are the same client', async () => {
    const { app } = await makeApp({ env: { TRUST_PROXY: 'x-real-ip' } });
    for (let i = 0; i < 4; i++) expect((await from(app, '203.0.113.7', 'mal')).statusCode).toBe(401);
    expect((await from(app, '::ffff:203.0.113.7', 'mal')).statusCode).toBe(429);
  });

  it('one password check in flight per /64', async () => {
    const { app } = await makeApp({ env: { TRUST_PROXY: 'x-real-ip' } });
    const [a, b] = await Promise.all([
      from(app, '2001:db8:1:2::1', 'mal'),
      from(app, '2001:db8:1:2::2', 'mal'),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([401, 429]);
  });

  it('a success from one address makes its whole /64 known', async () => {
    const { app, db, config } = await makeApp({ env: { TRUST_PROXY: 'x-real-ip' } });
    expect((await from(app, '2001:db8:1:2::1', PASSWORD)).statusCode).toBe(200);
    const auth = new AuthService(db, config.sessionTtlMs);
    expect(auth.isKnown(throttleKey('2001:db8:1:2:abcd::9'))).toBe(true);
    expect(auth.isKnown(throttleKey('2001:db8:1:3::1'))).toBe(false);
  });
});

describe('CSRF', () => {
  it('rejects a login from another origin', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://malicioso.example' },
      payload: { password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects cookie requests without Origin or Sec-Fetch-Site', async () => {
    const { app } = await makeApp();
    const token = cookieOf(await login(app, PASSWORD))!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { ol_session: token },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects cross-site Sec-Fetch-Site', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'sec-fetch-site': 'cross-site' },
      payload: { password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('devices (Android)', () => {
  async function register(app: Awaited<ReturnType<typeof makeApp>>['app']) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices',
      payload: { password: PASSWORD, name: 'Pixel 8', platform: 'android' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { deviceId: string; token: string };
  }

  it('registers with the password and uses a Bearer token without browser headers', async () => {
    const { app } = await makeApp();
    const { token } = await register(app);
    expect(token).toMatch(/^olt_/);
    const me = await app.inject({ url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.json()).toMatchObject({ kind: 'device', expiresAt: null });
  });

  it('device tokens do not expire over time', async () => {
    const { app, advance } = await makeApp();
    const { token } = await register(app);
    advance(400 * 24 * 60 * 60 * 1000);
    const me = await app.inject({ url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
  });

  it('devices are listed and revoked from the web', async () => {
    const { app } = await makeApp();
    const { deviceId, token } = await register(app);
    const web = cookieOf(await login(app, PASSWORD))!;
    const list = await app.inject({ url: '/api/v1/auth/devices', cookies: { ol_session: web } });
    expect(list.json().items.map((d: { name: string }) => d.name)).toEqual(
      expect.arrayContaining(['Pixel 8', 'Browser']),
    );
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/devices/${deviceId}`,
      headers: { origin: ORIGIN },
      cookies: { ol_session: web },
    });
    expect(del.statusCode).toBe(204);
    const me = await app.inject({ url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(401);
  });

  it('a wrong password does not register the device', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/devices',
      payload: { password: 'mal', name: 'Pixel 8' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('password change', () => {
  it('requires the current one, keeps this session and revokes the others', async () => {
    const { app } = await makeApp();
    const a = cookieOf(await login(app, PASSWORD))!;
    const b = cookieOf(await login(app, PASSWORD))!;
    const post = (current: string, next: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/password',
        headers: { origin: ORIGIN },
        cookies: { ol_session: a },
        payload: { current, next },
      });
    expect((await post('mal', 'another long password')).statusCode).toBe(401);
    expect((await post(PASSWORD, 'corta')).statusCode).toBe(400);
    expect((await post(PASSWORD, 'another long password')).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/v1/auth/me', cookies: { ol_session: a } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/auth/me', cookies: { ol_session: b } })).statusCode).toBe(401);
    expect((await login(app, PASSWORD)).statusCode).toBe(401);
    expect((await login(app, 'another long password')).statusCode).toBe(200);
  });
});
