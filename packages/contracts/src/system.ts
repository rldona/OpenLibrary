/** System and authentication contracts. */
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from './constants.js';

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
/** Recovery code: required with the password once a passkey exists (single use). */
const RecoveryCode = z.string().trim().min(1).max(64);

export const LoginRequest = z.object({
  password: z.string().min(1).max(256),
  recoveryCode: RecoveryCode.optional(),
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
  recoveryCode: RecoveryCode.optional(),
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

// ---------- Passkeys (WebAuthn) ----------
/** What the sign-in screens offer. */
export const AuthMethods = z.object({
  passwordConfigured: z.boolean(),
  /** At least one passkey: password-only sign-in is then refused (`passkey-required`). */
  passkeys: z.boolean(),
});
export type AuthMethods = z.infer<typeof AuthMethods>;

/** Confirms a sensitive action (add or remove a passkey, new recovery codes) with the password. */
export const PasswordConfirm = z.object({ password: z.string().min(1).max(256) });
export type PasswordConfirm = z.infer<typeof PasswordConfirm>;

/** WebAuthn JSON as produced and read by the browser / Credential Manager (opaque here). */
const WebAuthnJson = z.record(z.string(), z.unknown());

/** Options for one ceremony; `ceremonyId` comes back with the authenticator's answer. */
export const CeremonyOptions = z.object({
  ceremonyId: z.string(),
  options: WebAuthnJson,
});
export type CeremonyOptions = z.infer<typeof CeremonyOptions>;

export const PasskeyRegisterVerify = z.object({
  ceremonyId: z.string().min(1).max(100),
  response: WebAuthnJson,
  name: z.string().trim().min(1).max(80).optional(),
});
export type PasskeyRegisterVerify = z.infer<typeof PasskeyRegisterVerify>;

export const PasskeyLoginVerify = z.object({
  ceremonyId: z.string().min(1).max(100),
  response: WebAuthnJson,
});
export type PasskeyLoginVerify = z.infer<typeof PasskeyLoginVerify>;

export const PasskeyDeviceVerify = PasskeyLoginVerify.extend({
  name: z.string().trim().min(1).max(80),
  platform: z.enum(['android', 'web', 'other']).default('android'),
});
export type PasskeyDeviceVerify = z.infer<typeof PasskeyDeviceVerify>;

export const Passkey = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  /** Synced by a password manager (survives losing the device). */
  backedUp: z.boolean(),
});
export type Passkey = z.infer<typeof Passkey>;

export const PasskeyList = z.object({ items: z.array(Passkey) });
export type PasskeyList = z.infer<typeof PasskeyList>;

export const PasskeyRename = z.object({ name: z.string().trim().min(1).max(80) });
export type PasskeyRename = z.infer<typeof PasskeyRename>;

export const RecoveryCodes = z.object({
  /** Shown only once; the server stores just their hashes. */
  codes: z.array(z.string()),
});
export type RecoveryCodes = z.infer<typeof RecoveryCodes>;

export const PasskeyRegistered = z.object({
  passkey: Passkey,
  /** New recovery codes when this is the first passkey, otherwise null. */
  recoveryCodes: z.array(z.string()).nullable(),
});
export type PasskeyRegistered = z.infer<typeof PasskeyRegistered>;

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
