/**
 * Esquema de la base de datos (SQLite).
 * Sistema y autenticación (F0) + catálogo: obras, ediciones, ejemplares, ubicaciones, portadas e historial (F1).
 * Fechas en texto ISO-8601 UTC para que sean legibles en copias y exportaciones.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

// ============================================================================
// Catálogo (F1). Todas las entidades sincronizables comparten:
//   id (UUIDv7 del cliente), version (la incrementa el servidor), created_at, updated_at, deleted_at (lápida).
// Autores y géneros se guardan como listas JSON en la obra: cada campo es atómico para la fusión por campo.
// ============================================================================
const syncCols = {
  id: text('id').primaryKey(),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
};

export const works = sqliteTable(
  'works',
  {
    ...syncCols,
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    authors: text('authors', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    subjects: text('subjects', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    description: text('description'),
    originalTitle: text('original_title'),
    originalLanguage: text('original_language'),
    series: text('series'),
    seriesIndex: real('series_index'),
    /** Derivados para ordenar (sin tildes, minúsculas); no se sincronizan. */
    sortTitle: text('sort_title').notNull().default(''),
    sortAuthor: text('sort_author').notNull().default(''),
  },
  (t) => [index('works_sort_title_idx').on(t.sortTitle), index('works_sort_author_idx').on(t.sortAuthor)],
);

export const editions = sqliteTable(
  'editions',
  {
    ...syncCols,
    workId: text('work_id')
      .notNull()
      .references(() => works.id),
    title: text('title'),
    subtitle: text('subtitle'),
    publisher: text('publisher'),
    publishedYear: integer('published_year'),
    language: text('language'),
    pages: integer('pages'),
    format: text('format'),
    isbn13: text('isbn13'),
    coverAssetId: text('cover_asset_id'),
    metadataStatus: text('metadata_status', { enum: ['complete', 'provisional'] })
      .notNull()
      .default('complete'),
    metadataSource: text('metadata_source'),
  },
  (t) => [index('editions_work_idx').on(t.workId), index('editions_isbn13_idx').on(t.isbn13)],
);

export const copies = sqliteTable(
  'copies',
  {
    ...syncCols,
    editionId: text('edition_id')
      .notNull()
      .references(() => editions.id),
    /** Código humano EJ-0001, asignado por el servidor. */
    code: text('code').notNull().unique(),
    locationId: text('location_id').references(() => locations.id),
    condition: text('condition', { enum: ['new', 'fine', 'good', 'used', 'fair', 'poor'] })
      .notNull()
      .default('good'),
    acquiredOn: text('acquired_on'),
    priceCents: integer('price_cents'),
    priceCurrency: text('price_currency').notNull().default('EUR'),
    notes: text('notes').notNull().default(''),
    status: text('status', { enum: ['active', 'retired'] })
      .notNull()
      .default('active'),
    retiredReason: text('retired_reason'),
    retiredOn: text('retired_on'),
  },
  (t) => [index('copies_edition_idx').on(t.editionId), index('copies_location_idx').on(t.locationId)],
);

export const locations = sqliteTable(
  'locations',
  {
    ...syncCols,
    parentId: text('parent_id'),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['home', 'room', 'bookcase', 'shelf', 'box', 'other'] })
      .notNull()
      .default('other'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('locations_parent_idx').on(t.parentId)],
);

/** Portadas y otras imágenes, direccionadas por el SHA-256 del archivo original. */
export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  mime: text('mime').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  bytes: integer('bytes').notNull(),
  origin: text('origin', { enum: ['upload', 'provider', 'import'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * Historial de cambios: base de la sincronización (pull por cursor `seq`) y de la fusión por campo.
 * `fields` guarda los valores nuevos de los campos modificados.
 */
export const changeLog = sqliteTable(
  'change_log',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    entity: text('entity', { enum: ['work', 'edition', 'copy', 'location'] }).notNull(),
    entityId: text('entity_id').notNull(),
    op: text('op', { enum: ['create', 'update', 'delete'] }).notNull(),
    version: integer('version').notNull(),
    fields: text('fields', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    sessionId: text('session_id'),
    at: text('at').notNull(),
  },
  (t) => [index('change_log_entity_idx').on(t.entity, t.entityId, t.version)],
);

/** Caché de búsquedas en proveedores externos (no se sincroniza). */
export const lookupCache = sqliteTable('lookup_cache', {
  isbn13: text('isbn13').primaryKey(),
  payload: text('payload', { mode: 'json' }).notNull(),
  fetchedAt: text('fetched_at').notNull(),
});
