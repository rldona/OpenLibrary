/**
 * Contratos compartidos entre servidor y clientes (web; Android los consumirá vía OpenAPI).
 * Fuente de verdad de las formas de petición/respuesta de la API v1.
 */
import { z } from 'zod';

export const API_PREFIX = '/api/v1';

// ---------- Sistema ----------
export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  /** Cambia cuando se restaura una copia: los clientes deben resincronizar por completo. */
  epoch: z.string(),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// ---------- Autenticación ----------
export const PASSWORD_MIN_LENGTH = 12;

export const LoginRequest = z.object({
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const SessionInfo = z.object({
  authenticated: z.literal(true),
  kind: z.enum(['web', 'device']),
  sessionId: z.string(),
  expiresAt: z.string().nullable(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const DeviceRegisterRequest = z.object({
  password: z.string().min(1).max(256),
  name: z.string().trim().min(1).max(80),
  platform: z.enum(['android', 'web', 'other']).default('android'),
});
export type DeviceRegisterRequest = z.infer<typeof DeviceRegisterRequest>;

export const DeviceRegisterResponse = z.object({
  deviceId: z.string(),
  /** Se muestra una única vez; el servidor solo guarda su hash. */
  token: z.string(),
});
export type DeviceRegisterResponse = z.infer<typeof DeviceRegisterResponse>;

export const Device = z.object({
  id: z.string(),
  kind: z.enum(['web', 'device']),
  name: z.string(),
  platform: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  current: z.boolean(),
});
export type Device = z.infer<typeof Device>;

export const DeviceList = z.object({ items: z.array(Device) });
export type DeviceList = z.infer<typeof DeviceList>;

export const ChangePasswordRequest = z.object({
  current: z.string().min(1).max(256),
  next: z.string().min(PASSWORD_MIN_LENGTH).max(256),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

// ---------- Errores (RFC 9457) ----------
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
  retryAfterSeconds: z.number().optional(),
});
export type Problem = z.infer<typeof Problem>;

export * from './isbn.js';
export * from './ids.js';
export * from './catalog.js';
