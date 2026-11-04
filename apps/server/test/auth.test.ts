import { describe, expect, it } from 'vitest';
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
