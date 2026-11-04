/**
 * Esquema de la base de datos (SQLite).
 * F0: sistema y autenticación. Las tablas del catálogo (obras, ediciones, ejemplares…) llegan en F1.
 * Fechas en texto ISO-8601 UTC para que sean legibles en copias y exportaciones.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Pares clave/valor del sistema: epoch de datos, versión del esquema lógico… */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** El único propietario de la biblioteca. */
export const owner = sqliteTable(
  'owner',
  {
    id: integer('id').primaryKey(),
    passwordHash: text('password_hash').notNull(),
    passwordChangedAt: text('password_changed_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [check('owner_singleton', sql`${t.id} = 1`)],
);

/**
 * Sesiones web (cookie, caducan) y dispositivos (token bearer de larga duración, revocables).
 * Solo se guarda el hash SHA-256 del token, nunca el token.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    kind: text('kind', { enum: ['web', 'device'] }).notNull(),
    name: text('name').notNull(),
    platform: text('platform').notNull(),
    userAgent: text('user_agent'),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at'),
    expiresAt: text('expires_at'),
    revokedAt: text('revoked_at'),
  },
  (t) => [index('sessions_kind_idx').on(t.kind)],
);

/** Contador de intentos fallidos de login, por IP y global (protección contra fuerza bruta). */
export const authFailures = sqliteTable('auth_failures', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull(),
  windowStart: text('window_start').notNull(),
  lockedUntil: text('locked_until'),
});
