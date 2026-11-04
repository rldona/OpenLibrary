import { randomUUID } from 'node:crypto';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { PASSWORD_MIN_LENGTH } from '@openlibrary/contracts';
import type { Db } from '../db/client.js';
import { authFailures, owner, sessions } from '../db/schema.js';
import { badRequest } from '../errors.js';
import { hashPassword, newToken, sha256, verifyPassword } from './crypto.js';

export type Clock = () => Date;
export type SessionRow = typeof sessions.$inferSelect;

/** Brute-force lockout policy. */
export const THROTTLE = {
  /** Lockout starts once an IP reaches this many consecutive failures. */
  freeFailures: 5,
  /** First lockout; doubles with every further failure. */
  baseLockMs: 60_000,
  maxLockMs: 60 * 60_000,
  /** Window after which an IP's failures are forgotten. */
  windowMs: 15 * 60_000,
  /** Global limit (all IPs) per hour: slows down distributed attacks. */
  globalMaxPerHour: 100,
  globalLockMs: 15 * 60_000,
} as const;

/** How often last_seen / sliding expiry are updated (avoids one write per request). */
const TOUCH_EVERY_MS = 5 * 60_000;

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly sessionTtlMs: number,
    private readonly now: Clock = () => new Date(),
  ) {}

  // ---------- Owner ----------
  isConfigured(): boolean {
    return !!this.db.select({ id: owner.id }).from(owner).get();
  }

  /** Creates or changes the password. Revokes every session except the given one. */
  async setPassword(password: string, keepSessionId?: string): Promise<void> {
    if (password.length < PASSWORD_MIN_LENGTH) {
      throw badRequest('errors.passwordTooShort', { min: PASSWORD_MIN_LENGTH });
    }
    const ts = this.now().toISOString();
    const passwordHash = await hashPassword(password);
    this.db.transaction((tx) => {
      tx.insert(owner)
        .values({ id: 1, passwordHash, passwordChangedAt: ts, createdAt: ts })
        .onConflictDoUpdate({ target: owner.id, set: { passwordHash, passwordChangedAt: ts } })
        .run();
      const others = keepSessionId
        ? and(isNull(sessions.revokedAt), ne(sessions.id, keepSessionId))
        : isNull(sessions.revokedAt);
      tx.update(sessions).set({ revokedAt: ts }).where(others).run();
    });
  }

  async checkPassword(password: string): Promise<boolean> {
    const row = this.db.select().from(owner).get();
    if (!row) return false;
    return verifyPassword(row.passwordHash, password);
  }

  // ---------- Brute force ----------
  /** Seconds until the next attempt is allowed, or 0 if allowed now. */
  retryAfter(ip: string): number {
    const t = this.now().getTime();
    const wait = [this.failureRow(`ip:${ip}`), this.failureRow('global')]
      .map((r) => (r?.lockedUntil ? new Date(r.lockedUntil).getTime() - t : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    return wait > 0 ? Math.ceil(wait / 1000) : 0;
  }

  recordFailure(ip: string): void {
    const t = this.now().getTime();
    this.bump(`ip:${ip}`, t, THROTTLE.windowMs, (n) =>
      n >= THROTTLE.freeFailures
        ? Math.min(THROTTLE.baseLockMs * 2 ** (n - THROTTLE.freeFailures), THROTTLE.maxLockMs)
        : 0,
    );
    this.bump('global', t, 60 * 60_000, (n) => (n >= THROTTLE.globalMaxPerHour ? THROTTLE.globalLockMs : 0));
  }

  recordSuccess(ip: string): void {
    this.db
      .delete(authFailures)
      .where(eq(authFailures.key, `ip:${ip}`))
      .run();
  }

  private failureRow(key: string) {
    return this.db.select().from(authFailures).where(eq(authFailures.key, key)).get();
  }

  private bump(key: string, t: number, windowMs: number, lockFor: (failures: number) => number): void {
    const row = this.failureRow(key);
    const fresh = !row || t - new Date(row.windowStart).getTime() > windowMs;
    const failures = fresh ? 1 : row.failures + 1;
    const windowStart = fresh ? new Date(t).toISOString() : row.windowStart;
    const lock = lockFor(failures);
    const lockedUntil = lock ? new Date(t + lock).toISOString() : null;
    this.db
      .insert(authFailures)
      .values({ key, failures, windowStart, lockedUntil })
      .onConflictDoUpdate({ target: authFailures.key, set: { failures, windowStart, lockedUntil } })
      .run();
  }

  // ---------- Sessions and devices ----------
  createSession(input: { kind: 'web' | 'device'; name: string; platform: string; userAgent?: string }): {
    id: string;
    token: string;
    expiresAt: string | null;
  } {
    const now = this.now();
    const token = newToken();
    const id = randomUUID();
    const expiresAt = input.kind === 'web' ? new Date(now.getTime() + this.sessionTtlMs).toISOString() : null;
    this.db
      .insert(sessions)
      .values({
        id,
        tokenHash: sha256(token),
        kind: input.kind,
        name: input.name,
        platform: input.platform,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        expiresAt,
      })
      .run();
    return { id, token, expiresAt };
  }

  /** Validates a token and returns its active session (renewing the sliding expiry of web sessions). */
  authenticate(token: string | undefined): SessionRow | null {
    if (!token || token.length > 200) return null;
    const row = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, sha256(token)))
      .get();
    if (!row || row.revokedAt) return null;
    const now = this.now();
    if (row.expiresAt && new Date(row.expiresAt) <= now) return null;
    if (!row.lastSeenAt || now.getTime() - new Date(row.lastSeenAt).getTime() > TOUCH_EVERY_MS) {
      const patch = {
        lastSeenAt: now.toISOString(),
        ...(row.kind === 'web'
          ? { expiresAt: new Date(now.getTime() + this.sessionTtlMs).toISOString() }
          : {}),
      };
      this.db.update(sessions).set(patch).where(eq(sessions.id, row.id)).run();
      Object.assign(row, patch);
    }
    return row;
  }

  listActive(): SessionRow[] {
    const now = this.now().toISOString();
    return this.db
      .select()
      .from(sessions)
      .where(isNull(sessions.revokedAt))
      .all()
      .filter((s) => !s.expiresAt || s.expiresAt > now)
      .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));
  }

  revoke(id: string): boolean {
    const r = this.db
      .update(sessions)
      .set({ revokedAt: this.now().toISOString() })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
      .run();
    return r.changes > 0;
  }
}
