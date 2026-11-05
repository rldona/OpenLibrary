/**
 * Contracts shared between the server and its clients (web; Android will consume them via OpenAPI).
 * Source of truth for the request/response shapes of API v1.
 */
import { z } from 'zod';

export const API_PREFIX = '/api/v1';

// ---------- System ----------
export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  /** Changes when a backup is restored: clients must perform a full resync. */
  epoch: z.string(),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// ---------- Authentication ----------
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
  /** Shown only once; the server stores just its hash. */
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

// ---------- Errors (RFC 9457) ----------
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
  /** Stable machine-readable error code (the `type` URL ends with it too). */
  code: z.string().optional(),
  retryAfterSeconds: z.number().optional(),
});
export type Problem = z.infer<typeof Problem>;

export * from './isbn.js';
export * from './ids.js';
export * from './catalog.js';
export * from './sync.js';
export * from './stats.js';
export * from './portability.js';
export * from './i18n.js';
