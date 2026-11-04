import type { z } from 'zod';

/** Error HTTP que se serializa como application/problem+json (RFC 9457). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const badRequest = (detail: string) => new HttpError(400, 'bad-request', detail);
export const unauthorized = (detail = 'Necesitas iniciar sesión.') =>
  new HttpError(401, 'unauthorized', detail);
export const forbidden = (detail: string) => new HttpError(403, 'forbidden', detail);
export const notFound = (detail = 'No encontrado.') => new HttpError(404, 'not-found', detail);
export const tooMany = (retryAfterSeconds: number) =>
  new HttpError(429, 'too-many-attempts', 'Demasiados intentos. Espera antes de volver a probar.', {
    retryAfterSeconds,
  });

export const TITLES: Record<number, string> = {
  400: 'Petición no válida',
  401: 'No autenticado',
  403: 'Prohibido',
  404: 'No encontrado',
  409: 'Conflicto',
  429: 'Demasiadas peticiones',
  500: 'Error interno',
  503: 'Servicio no disponible',
};

/** Valida con zod y convierte los errores en 400 legibles. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`).join('; ');
    throw badRequest(msg);
  }
  return r.data;
}
