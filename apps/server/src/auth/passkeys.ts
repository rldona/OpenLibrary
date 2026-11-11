import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { CeremonyOptions, Passkey } from '@openlibrary/contracts';
import { getMeta, setMeta, type Db } from '../db/client.js';
import { passkeys, recoveryCodes } from '../db/schema.js';
import { sha256 } from './crypto.js';
import type { Clock } from './service.js';

export type PasskeyConfig = {
  /** Relying-party id: the hostname of PUBLIC_URL. Passkeys are bound to it. */
  rpId: string;
  /** Origins accepted in the authenticator's answer: the web origins and the Android app's. */
  origins: string[];
};

type Ceremony = { kind: 'register' | 'login'; challenge: string; sessionId?: string; expiresAt: number };

/** A ceremony must be finished within this time; its challenge is then forgotten. */
export const CEREMONY_TTL_MS = 5 * 60_000;
/** Bounds the challenges kept in memory (anyone can ask for sign-in options). */
const MAX_CEREMONIES = 500;
export const RECOVERY_CODE_COUNT = 10;
/** 32 characters without look-alikes (no i, l, o, 1): 5 bits each. */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz023456789';

export type PasskeyRow = typeof passkeys.$inferSelect;

/** Thrown for any failed ceremony; the routes turn it into one generic error (and a lockout failure). */
export class PasskeyError extends Error {}

/**
 * Passkeys of the single owner: WebAuthn registration and authentication (discoverable credentials,
 * user verification required) and the recovery codes that go with them. No external service.
 * Challenges live in memory: single use, short-lived, one server process.
 */
export class PasskeyService {
  private readonly ceremonies = new Map<string, Ceremony>();

  constructor(
    private readonly db: Db,
    private readonly config: PasskeyConfig,
    private readonly now: Clock = () => new Date(),
  ) {}

  hasAny(): boolean {
    return !!this.db.select({ id: passkeys.id }).from(passkeys).get();
  }

  list(): Passkey[] {
    return this.db
      .select()
      .from(passkeys)
      .all()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(toDto);
  }

  rename(id: string, name: string): boolean {
    return this.db.update(passkeys).set({ name }).where(eq(passkeys.id, id)).run().changes > 0;
  }

  remove(id: string): boolean {
    const removed = this.db.delete(passkeys).where(eq(passkeys.id, id)).run().changes > 0;
    // With the last passkey gone, password-only sign-in is back: old recovery codes mean nothing.
    if (removed && !this.hasAny()) this.db.delete(recoveryCodes).run();
    return removed;
  }

  /** Removes every passkey and recovery code (CLI `passkeys-reset`): back to password-only. */
  reset(): { passkeys: number; codes: number } {
    return this.db.transaction((tx) => ({
      passkeys: tx.delete(passkeys).run().changes,
      codes: tx.delete(recoveryCodes).run().changes,
    }));
  }

  // ---------- Registration (with a session and the password, checked by the route) ----------
  async registrationOptions(sessionId: string): Promise<CeremonyOptions> {
    const existing = this.db.select().from(passkeys).all();
    const options = await generateRegistrationOptions({
      rpName: 'OpenLibrary',
      rpID: this.config.rpId,
      userID: this.userId(),
      userName: 'OpenLibrary',
      userDisplayName: 'OpenLibrary',
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: transportsOf(p) })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: CEREMONY_TTL_MS,
    });
    return {
      ceremonyId: this.begin({ kind: 'register', challenge: options.challenge, sessionId }),
      options: json(options),
    };
  }

  async verifyRegistration(
    ceremonyId: string,
    sessionId: string,
    response: unknown,
    name: string | undefined,
  ): Promise<{ passkey: Passkey; recoveryCodes: string[] | null }> {
    const c = this.take(ceremonyId, 'register');
    if (c.sessionId !== sessionId) throw new PasskeyError('ceremony of another session');
    const r = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: c.challenge,
      expectedOrigin: this.config.origins,
      expectedRPID: this.config.rpId,
      requireUserVerification: true,
    }).catch((e: unknown) => {
      throw new PasskeyError((e as Error).message);
    });
    if (!r.verified) throw new PasskeyError('registration not verified');
    const { credential, credentialBackedUp } = r.registrationInfo;
    const first = !this.hasAny();
    const ts = this.now().toISOString();
    const row: PasskeyRow = {
      id: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      name: name ?? 'Passkey',
      backedUp: credentialBackedUp,
      createdAt: ts,
      lastUsedAt: null,
    };
    let codes: string[] | null = null;
    this.db.transaction((tx) => {
      if (tx.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.id, row.id)).get()) {
        throw new PasskeyError('credential already registered');
      }
      tx.insert(passkeys).values(row).run();
      if (first) codes = this.replaceCodes(tx);
    });
    return { passkey: toDto(row), recoveryCodes: codes };
  }

  // ---------- Authentication (web sign-in and device registration) ----------
  async authenticationOptions(): Promise<CeremonyOptions> {
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      // Discoverable credentials: the authenticator offers the owner's passkey by itself.
      allowCredentials: [],
      userVerification: 'required',
      timeout: CEREMONY_TTL_MS,
    });
    return {
      ceremonyId: this.begin({ kind: 'login', challenge: options.challenge }),
      options: json(options),
    };
  }

  /** Verifies a sign-in; throws [PasskeyError] on any failure. Updates the signature counter. */
  async verifyAuthentication(ceremonyId: string, response: unknown): Promise<PasskeyRow> {
    const c = this.take(ceremonyId, 'login');
    const answer = response as AuthenticationResponseJSON;
    const id = typeof answer?.id === 'string' ? answer.id : '';
    const row = this.db.select().from(passkeys).where(eq(passkeys.id, id)).get();
    if (!row) throw new PasskeyError('unknown credential');
    const r = await verifyAuthenticationResponse({
      response: answer,
      expectedChallenge: c.challenge,
      expectedOrigin: this.config.origins,
      expectedRPID: this.config.rpId,
      credential: {
        id: row.id,
        publicKey: isoBase64URL.toBuffer(row.publicKey),
        counter: row.counter,
        transports: transportsOf(row),
      },
      requireUserVerification: true,
    }).catch((e: unknown) => {
      // Includes a signature counter that went backwards (a cloned authenticator).
      throw new PasskeyError((e as Error).message);
    });
    if (!r.verified) throw new PasskeyError('authentication not verified');
    const patch = {
      counter: r.authenticationInfo.newCounter,
      backedUp: r.authenticationInfo.credentialBackedUp,
      lastUsedAt: this.now().toISOString(),
    };
    this.db.update(passkeys).set(patch).where(eq(passkeys.id, row.id)).run();
    return { ...row, ...patch };
  }

  // ---------- Recovery codes ----------
  /** New set of codes, replacing the old ones. Shown once. */
  regenerateCodes(): string[] {
    return this.db.transaction((tx) => this.replaceCodes(tx));
  }

  /** Consumes a code if it is valid and unused (single use, atomically). */
  useCode(code: string): boolean {
    const r = this.db
      .update(recoveryCodes)
      .set({ usedAt: this.now().toISOString() })
      .where(and(eq(recoveryCodes.codeHash, sha256(normaliseCode(code))), isNull(recoveryCodes.usedAt)))
      .run();
    return r.changes > 0;
  }

  remainingCodes(): number {
    return this.db.select().from(recoveryCodes).where(isNull(recoveryCodes.usedAt)).all().length;
  }

  private replaceCodes(tx: Pick<Db, 'insert' | 'delete'>): string[] {
    const ts = this.now().toISOString();
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newCode);
    tx.delete(recoveryCodes).run();
    for (const code of codes) {
      tx.insert(recoveryCodes)
        .values({ codeHash: sha256(normaliseCode(code)), createdAt: ts, usedAt: null })
        .run();
    }
    return codes;
  }

  // ---------- Ceremonies ----------
  private begin(c: Omit<Ceremony, 'expiresAt'>): string {
    const t = this.now().getTime();
    for (const [id, old] of this.ceremonies) if (old.expiresAt <= t) this.ceremonies.delete(id);
    while (this.ceremonies.size >= MAX_CEREMONIES) {
      this.ceremonies.delete(this.ceremonies.keys().next().value!);
    }
    const id = randomUUID();
    this.ceremonies.set(id, { ...c, expiresAt: t + CEREMONY_TTL_MS });
    return id;
  }

  /** Single use: the challenge is forgotten whatever the outcome. */
  private take(id: string, kind: Ceremony['kind']): Ceremony {
    const c = this.ceremonies.get(id);
    this.ceremonies.delete(id);
    if (!c || c.kind !== kind || c.expiresAt <= this.now().getTime()) {
      throw new PasskeyError('unknown or expired ceremony');
    }
    return c;
  }

  /** Stable WebAuthn user handle of the owner, so a new passkey replaces the old one on the same authenticator. */
  private userId(): Uint8Array<ArrayBuffer> {
    let v = getMeta(this.db, 'webauthn_user_id');
    if (!v) {
      v = isoBase64URL.fromBuffer(new Uint8Array(randomBytes(16)));
      setMeta(this.db, 'webauthn_user_id', v);
    }
    return isoBase64URL.toBuffer(v) as Uint8Array<ArrayBuffer>;
  }
}

/** WebAuthn options as the opaque JSON object of the contract. */
const json = (o: object) => o as Record<string, unknown>;

const toDto = (p: PasskeyRow): Passkey => ({
  id: p.id,
  name: p.name,
  createdAt: p.createdAt,
  lastUsedAt: p.lastUsedAt,
  backedUp: p.backedUp,
});

function transportsOf(p: PasskeyRow): string[] | undefined {
  try {
    return p.transports ? (JSON.parse(p.transports) as string[]) : undefined;
  } catch {
    return undefined;
  }
}

/** `xxxx-xxxx-xxxx` from an alphabet without look-alikes: about 60 bits each. */
function newCode(): string {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b & 31]!).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** Case, spaces and dashes do not matter when typing a code. */
export const normaliseCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
