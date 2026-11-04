import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// Argon2id parameters recommended by OWASP (19 MiB, 2 iterations, 1 thread).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, ARGON);

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** Opaque 256-bit token. The prefix makes it easy to spot if it leaks into logs or repositories. */
export const newToken = () => `olt_${randomBytes(32).toString('base64url')}`;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
