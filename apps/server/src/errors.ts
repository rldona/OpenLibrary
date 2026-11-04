import { z } from 'zod';
import type { Lang, Params } from '@openlibrary/contracts';
import { tr } from './i18n.js';

/**
 * HTTP error serialised as application/problem+json (RFC 9457).
 * It carries a message KEY plus parameters; the text is translated when the response is sent,
 * in the language of the request.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly key: string,
    public readonly params: Params = {},
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(key);
  }
}

export const badRequest = (key: string, params?: Params) => new HttpError(400, 'bad-request', key, params);
export const unauthorized = (key = 'errors.unauthorized') => new HttpError(401, 'unauthorized', key);
export const forbidden = (key: string, params?: Params) => new HttpError(403, 'forbidden', key, params);
export const notFound = (key = 'errors.notFound', params?: Params) =>
  new HttpError(404, 'not-found', key, params);
export const tooMany = (retryAfterSeconds: number) =>
  new HttpError(429, 'too-many-attempts', 'errors.tooManyAttempts', {}, { retryAfterSeconds });

const ZOD_LOCALES = { en: z.locales.en(), es: z.locales.es() } as const;

/**
 * Validates with zod and turns failures into a readable, translated 400.
 * Our schemas use i18n keys as custom messages; zod's own messages use zod's locale for the language.
 */
export function parse<T extends z.ZodType>(schema: T, value: unknown, lang: Lang = 'en'): z.infer<T> {
  const r = schema.safeParse(value, { error: ZOD_LOCALES[lang].localeError });
  if (!r.success) {
    const t = tr(lang);
    const details = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${t(i.message)}`).join('; ');
    throw new HttpError(400, 'validation', 'errors.validation', { details });
  }
  return r.data;
}
