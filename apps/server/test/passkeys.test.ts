import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { androidOrigin } from '../src/config.js';
import { CEREMONY_TTL_MS } from '../src/auth/passkeys.js';
import { cookieOf, makeApp, ORIGIN, PASSWORD } from './helpers.js';
import { VirtualAuthenticator } from './webauthn.js';

type App = Awaited<ReturnType<typeof makeApp>>['app'];
const RP_ID = new URL(ORIGIN).hostname;
const CERT = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':');

async function call(
  app: App,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
  cookie?: string,
  ip = '10.0.0.1',
) {
  const r = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { origin: ORIGIN },
    remoteAddress: ip,
    ...(cookie ? { cookies: { ol_session: cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
  return { status: r.statusCode, body: r.body ? r.json() : undefined, cookie: cookieOf(r) };
}

/** A signed-in browser that registers the virtual authenticator as the first passkey. */
async function withPasskey(env: Record<string, string> = {}) {
  const h = await makeApp({ env });
  const session = (await call(h.app, 'POST', '/auth/login', { password: PASSWORD })).cookie!;
  const key = new VirtualAuthenticator(ORIGIN, RP_ID);
  const opts = await call(h.app, 'POST', '/auth/passkeys/options', { password: PASSWORD }, session);
  expect(opts.status).toBe(200);
  expect(opts.body.options.authenticatorSelection).toMatchObject({
    residentKey: 'required',
    userVerification: 'required',
  });
  const reg = await call(
    h.app,
    'POST',
    '/auth/passkeys/verify',
    { ceremonyId: opts.body.ceremonyId, response: key.register(opts.body.options), name: 'Pixel' },
    session,
  );
  expect(reg.status).toBe(201);
  return { ...h, session, key, codes: reg.body.recoveryCodes as string[] };
}

const passkeyLogin = async (app: App, key: VirtualAuthenticator, ip?: string) => {
  const o = await call(app, 'POST', '/auth/login/passkey/options', {}, undefined, ip);
  return call(
    app,
    'POST',
    '/auth/login/passkey/verify',
    { ceremonyId: o.body.ceremonyId, response: key.login(o.body.options) },
    undefined,
    ip,
  );
};

describe('passkeys', () => {
  it('with no passkey, everything is as before', async () => {
    const { app } = await makeApp();
    expect((await call(app, 'GET', '/auth/methods')).body).toEqual({
      passwordConfigured: true,
      passkeys: false,
    });
    expect((await call(app, 'POST', '/auth/login', { password: PASSWORD })).status).toBe(200);
    expect((await call(app, 'POST', '/auth/devices', { password: PASSWORD, name: 'Pixel' })).status).toBe(
      201,
    );
  });

  it('registers the first passkey with ten one-time recovery codes', async () => {
    const { app, session, codes, key } = await withPasskey();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    const list = await call(app, 'GET', '/auth/passkeys', undefined, session);
    expect(list.body.items).toEqual([
      { id: key.id, name: 'Pixel', createdAt: expect.any(String), lastUsedAt: null, backedUp: false },
    ]);
    expect((await call(app, 'GET', '/auth/methods')).body.passkeys).toBe(true);
  });

  it('adding a passkey needs a session and the password', async () => {
    const { app } = await makeApp();
    expect((await call(app, 'POST', '/auth/passkeys/options', { password: PASSWORD })).status).toBe(401);
    const session = (await call(app, 'POST', '/auth/login', { password: PASSWORD })).cookie!;
    expect(
      (await call(app, 'POST', '/auth/passkeys/options', { password: 'wrong one' }, session)).status,
    ).toBe(401);
  });

  it('a second passkey gets no new recovery codes; the same authenticator cannot register twice', async () => {
    const { app, session, key } = await withPasskey();
    const other = new VirtualAuthenticator(ORIGIN, RP_ID);
    const o = await call(app, 'POST', '/auth/passkeys/options', { password: PASSWORD }, session);
    expect(o.body.options.excludeCredentials).toEqual([
      { id: key.id, type: 'public-key', transports: ['internal'] },
    ]);
    const r = await call(
      app,
      'POST',
      '/auth/passkeys/verify',
      { ceremonyId: o.body.ceremonyId, response: other.register(o.body.options) },
      session,
    );
    expect(r.status).toBe(201);
    expect(r.body.recoveryCodes).toBeNull();
    const again = await call(app, 'POST', '/auth/passkeys/options', { password: PASSWORD }, session);
    const dup = await call(
      app,
      'POST',
      '/auth/passkeys/verify',
      { ceremonyId: again.body.ceremonyId, response: key.register(again.body.options) },
      session,
    );
    expect(dup.status).toBe(403);
  });

  it('signs in on the web with the passkey and updates its counter', async () => {
    const { app, session, key } = await withPasskey();
    const r = await passkeyLogin(app, key);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ authenticated: true, kind: 'web' });
    expect((await call(app, 'GET', '/auth/me', undefined, r.cookie)).status).toBe(200);
    const [item] = (await call(app, 'GET', '/auth/passkeys', undefined, session)).body.items;
    expect(item.lastUsedAt).not.toBeNull();
  });

  it('registers a device with the passkey; the token works', async () => {
    const { app, key } = await withPasskey();
    const o = await call(app, 'POST', '/auth/login/passkey/options', {});
    const r = await call(app, 'POST', '/auth/devices/passkey', {
      ceremonyId: o.body.ceremonyId,
      response: key.login(o.body.options),
      name: 'Pixel',
    });
    expect(r.status).toBe(201);
    const me = await app.inject({
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${r.body.token}` },
    });
    expect(me.json()).toMatchObject({ kind: 'device', sessionId: r.body.deviceId });
  });

  it('a challenge cannot be replayed', async () => {
    const { app, key } = await withPasskey();
    const o = await call(app, 'POST', '/auth/login/passkey/options', {});
    const answer = key.login(o.body.options);
    expect(
      (
        await call(app, 'POST', '/auth/login/passkey/verify', {
          ceremonyId: o.body.ceremonyId,
          response: answer,
        })
      ).status,
    ).toBe(200);
    const replay = await call(app, 'POST', '/auth/login/passkey/verify', {
      ceremonyId: o.body.ceremonyId,
      response: answer,
    });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('unauthorized');
  });

  it('a challenge expires', async () => {
    const { app, key, advance } = await withPasskey();
    const o = await call(app, 'POST', '/auth/login/passkey/options', {});
    advance(CEREMONY_TTL_MS + 1000);
    expect(
      (
        await call(app, 'POST', '/auth/login/passkey/verify', {
          ceremonyId: o.body.ceremonyId,
          response: key.login(o.body.options),
        })
      ).status,
    ).toBe(401);
  });

  it('rejects another origin or another relying party', async () => {
    const { app, key } = await withPasskey();
    key.origin = 'https://phishing.example';
    expect((await passkeyLogin(app, key)).status).toBe(401);
    key.origin = ORIGIN;
    key.rpId = 'phishing.example';
    expect((await passkeyLogin(app, key)).status).toBe(401);
    key.rpId = RP_ID;
    expect((await passkeyLogin(app, key)).status).toBe(200);
  });

  it('rejects a signature counter that goes backwards (cloned authenticator)', async () => {
    const { app, key } = await withPasskey();
    expect((await passkeyLogin(app, key)).status).toBe(200);
    expect((await passkeyLogin(app, key)).status).toBe(200);
    key.counter = 1;
    const o = await call(app, 'POST', '/auth/login/passkey/options', {});
    const r = await call(app, 'POST', '/auth/login/passkey/verify', {
      ceremonyId: o.body.ceremonyId,
      response: key.login(o.body.options, { keepCounter: true }),
    });
    expect(r.status).toBe(401);
  });

  it('requires user verification', async () => {
    const { app, key } = await withPasskey();
    key.flags = 0x01;
    expect((await passkeyLogin(app, key)).status).toBe(401);
  });

  it('an unknown credential is rejected, and failures count for the lockout', async () => {
    const { app } = await withPasskey();
    const stranger = new VirtualAuthenticator(ORIGIN, RP_ID);
    for (let i = 0; i < 4; i++) expect((await passkeyLogin(app, stranger, '10.9.9.9')).status).toBe(401);
    expect((await passkeyLogin(app, stranger, '10.9.9.9')).status).toBe(429);
  });

  it('once a passkey exists, the password alone is refused for the web and for devices', async () => {
    const { app } = await withPasskey();
    const web = await call(app, 'POST', '/auth/login', { password: PASSWORD });
    expect(web.status).toBe(403);
    expect(web.body.code).toBe('passkey-required');
    const device = await call(app, 'POST', '/auth/devices', { password: PASSWORD, name: 'Pixel' });
    expect(device.status).toBe(403);
    expect(device.body.code).toBe('passkey-required');
    // Refused before the password is checked: a wrong one gets the same answer.
    expect((await call(app, 'POST', '/auth/login', { password: 'nope' })).body.code).toBe('passkey-required');
  });

  it('a recovery code works once, together with the password', async () => {
    const { app, codes } = await withPasskey();
    const code = codes[0]!.toUpperCase().replace(/-/g, ' ');
    expect((await call(app, 'POST', '/auth/login', { password: PASSWORD, recoveryCode: code })).status).toBe(
      200,
    );
    const again = await call(app, 'POST', '/auth/login', { password: PASSWORD, recoveryCode: code });
    expect(again.status).toBe(401);
    expect(again.body.code).toBe('unauthorized');
    // A wrong password with a valid code does not use up the code.
    expect(
      (
        await call(app, 'POST', '/auth/devices', {
          password: 'wrong password',
          recoveryCode: codes[1],
          name: 'P',
        })
      ).status,
    ).toBe(401);
    expect(
      (await call(app, 'POST', '/auth/devices', { password: PASSWORD, recoveryCode: codes[1], name: 'P' }))
        .status,
    ).toBe(201);
  });

  it('the password is still needed to remove a passkey; removing the last one brings password-only back', async () => {
    const { app, session, key, codes } = await withPasskey();
    expect((await call(app, 'PATCH', `/auth/passkeys/${key.id}`, { name: 'Phone' }, session)).status).toBe(
      204,
    );
    expect((await call(app, 'GET', '/auth/passkeys', undefined, session)).body.items[0].name).toBe('Phone');
    expect(
      (await call(app, 'DELETE', `/auth/passkeys/${key.id}`, { password: 'wrong one' }, session)).status,
    ).toBe(401);
    expect(
      (await call(app, 'DELETE', `/auth/passkeys/${key.id}`, { password: PASSWORD }, session)).status,
    ).toBe(204);
    expect((await call(app, 'POST', '/auth/login', { password: PASSWORD })).status).toBe(200);
    // Its recovery codes are gone too.
    const fresh = await withPasskey();
    expect(fresh.codes).not.toContain(codes[0]);
  });

  it('regenerates recovery codes (old ones stop working)', async () => {
    const { app, session, codes } = await withPasskey();
    const r = await call(app, 'POST', '/auth/recovery-codes', { password: PASSWORD }, session);
    expect(r.body.codes).toHaveLength(10);
    expect(
      (await call(app, 'POST', '/auth/login', { password: PASSWORD, recoveryCode: codes[0] })).status,
    ).toBe(401);
    expect(
      (await call(app, 'POST', '/auth/login', { password: PASSWORD, recoveryCode: r.body.codes[0] })).status,
    ).toBe(200);
  });

  it('accepts the Android app origin for the configured certificate and serves assetlinks.json', async () => {
    const { app, key } = await withPasskey({ ANDROID_CERT_SHA256: CERT });
    key.origin = androidOrigin(CERT);
    expect(key.origin).toMatch(/^android:apk-key-hash:[A-Za-z0-9_-]{43}$/);
    expect((await passkeyLogin(app, key)).status).toBe(200);
    const links = await app.inject('/.well-known/assetlinks.json');
    expect(links.json()).toEqual([
      {
        relation: [
          'delegate_permission/common.handle_all_urls',
          'delegate_permission/common.get_login_creds',
        ],
        target: {
          namespace: 'android_app',
          package_name: 'io.github.rldona.openlibrary',
          sha256_cert_fingerprints: [CERT],
        },
      },
    ]);
  });

  it('without a certificate there is no assetlinks.json and no Android origin', async () => {
    const { app, key } = await withPasskey();
    expect((await app.inject('/.well-known/assetlinks.json')).statusCode).toBe(404);
    key.origin = androidOrigin(CERT);
    expect((await passkeyLogin(app, key)).status).toBe(401);
  });
});

describe('passkeys-reset (CLI)', () => {
  it('removes every passkey and recovery code: the password alone signs in again', async () => {
    const { dataDir } = await makeApp();
    const run = (...args: string[]) =>
      execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
        env: { ...process.env, DATA_DIR: dataDir, OL_PASSWORD: 'a long password', NODE_ENV: 'test' },
        encoding: 'utf8',
      });
    run('set-password');
    // Seed a passkey row through the service, the way the server would.
    const { openDb } = await import('../src/db/client.js');
    const { passkeys, recoveryCodes } = await import('../src/db/schema.js');
    const db = openDb(`${dataDir}/library.db`);
    db.insert(passkeys)
      .values({
        id: 'k1',
        publicKey: 'x',
        counter: 0,
        transports: null,
        name: 'P',
        backedUp: false,
        createdAt: 't',
        lastUsedAt: null,
      })
      .run();
    db.insert(recoveryCodes).values({ codeHash: 'h', createdAt: 't', usedAt: null }).run();
    db.$client.close();
    expect(run('passkeys-reset')).toContain('Passkeys removed: 1. Recovery codes removed: 1.');
    const after = openDb(`${dataDir}/library.db`);
    expect(after.select().from(passkeys).all()).toEqual([]);
    expect(after.select().from(recoveryCodes).all()).toEqual([]);
    after.$client.close();
  });
});

describe('config', () => {
  it('rejects a malformed Android certificate fingerprint', async () => {
    await expect(makeApp({ env: { ANDROID_CERT_SHA256: 'AB:CD' } })).rejects.toThrow(/ANDROID_CERT_SHA256/);
  });
});
