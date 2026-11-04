/**
 * Contratos del catálogo: obras, ediciones, ejemplares y ubicaciones.
 *
 * Reglas comunes:
 * - Los IDs son UUIDv7 que puede generar el cliente (opcional en la creación).
 * - Toda entidad tiene `version`; las modificaciones envían `baseVersion` (la versión que el cliente vio).
 *   Si otro dispositivo cambió los MISMOS campos después, el servidor responde 409 con los conflictos;
 *   si cambió otros campos, se fusiona sin perder nada.
 */
import { z } from 'zod';
import { normalizeIsbn } from './isbn.js';
import { SHA256_RE, UUID_RE } from './ids.js';

export const Id = z.string().regex(UUID_RE, 'id no válido');
export const AssetId = z.string().regex(SHA256_RE, 'id de recurso no válido');
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const nameList = z
  .array(z.string().trim().min(1).max(200))
  .max(30)
  .transform((a) => [...new Set(a)]);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD');

/** ISBN opcional: se normaliza a ISBN-13; si no es válido, error. */
export const IsbnField = z
  .string()
  .nullish()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const r = normalizeIsbn(v);
    if (!r.ok) {
      ctx.addIssue({ code: 'custom', message: r.reason });
      return z.NEVER;
    }
    return r.isbn13;
  });

// ---------- Enumeraciones ----------
export const LOCATION_KINDS = ['home', 'room', 'bookcase', 'shelf', 'box', 'other'] as const;
export const LocationKind = z.enum(LOCATION_KINDS);
export type LocationKind = z.infer<typeof LocationKind>;

export const CONDITIONS = ['new', 'fine', 'good', 'used', 'fair', 'poor'] as const;
export const Condition = z.enum(CONDITIONS);
export type Condition = z.infer<typeof Condition>;
export const CONDITION_LABELS: Record<Condition, string> = {
  new: 'Como nuevo',
  fine: 'Excelente',
  good: 'Bueno',
  used: 'Usado',
  fair: 'Aceptable',
  poor: 'Deteriorado',
};

export const RETIRE_REASONS = ['gifted', 'sold', 'lost', 'damaged', 'other'] as const;
export const RetireReason = z.enum(RETIRE_REASONS);
export const RETIRE_LABELS: Record<z.infer<typeof RetireReason>, string> = {
  gifted: 'Regalado',
  sold: 'Vendido',
  lost: 'Perdido',
  damaged: 'Deteriorado',
  other: 'Otro',
};

export const MetadataStatus = z.enum(['complete', 'provisional']);

// ---------- Campos editables ----------
export const WorkFields = z.object({
  title: text(500).min(1, 'El título es obligatorio'),
  subtitle: optText(500),
  authors: nameList.default([]),
  subjects: nameList.default([]),
  description: optText(10_000),
  originalTitle: optText(500),
  originalLanguage: optText(8),
  series: optText(200),
  seriesIndex: z.number().min(0).max(100_000).nullish().default(null),
});
export type WorkFields = z.infer<typeof WorkFields>;

export const EditionFields = z.object({
  /** Solo si la edición tiene un título distinto al de la obra (p. ej. traducción). */
  title: optText(500),
  subtitle: optText(500),
  publisher: optText(200),
  publishedYear: z.number().int().min(0).max(2100).nullish().default(null),
  language: optText(8),
  pages: z.number().int().min(1).max(100_000).nullish().default(null),
  format: optText(100),
  isbn13: IsbnField.default(null),
  coverAssetId: AssetId.nullish().default(null),
  metadataStatus: MetadataStatus.default('complete'),
  metadataSource: optText(100),
});
export type EditionFields = z.infer<typeof EditionFields>;

export const CopyFields = z.object({
  locationId: Id.nullish().default(null),
  condition: Condition.default('good'),
  acquiredOn: IsoDate.nullish().default(null),
  /** Precio en céntimos para evitar decimales. */
  priceCents: z.number().int().min(0).max(100_000_000).nullish().default(null),
  priceCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('EUR'),
  notes: text(5000).default(''),
});
export type CopyFields = z.infer<typeof CopyFields>;

// ---------- Creación ----------
/** Alta completa: obra nueva o existente + edición + primer ejemplar, en una sola operación. */
export const BookCreate = z
  .object({
    workId: Id.optional(),
    work: WorkFields.extend({ id: Id.optional() }).optional(),
    edition: EditionFields.extend({ id: Id.optional() }),
    copy: CopyFields.extend({ id: Id.optional() }),
    /** Confirmación explícita para crear una edición con un ISBN que ya existe. */
    allowDuplicateIsbn: z.boolean().default(false),
  })
  .refine((b) => !!b.workId !== !!b.work, {
    message: 'Indica una obra existente (workId) o una nueva (work)',
  });
export type BookCreate = z.input<typeof BookCreate>;

export const CopyCreate = CopyFields.extend({ id: Id.optional(), editionId: Id });
export type CopyCreate = z.input<typeof CopyCreate>;

export const LocationCreate = z.object({
  id: Id.optional(),
  parentId: Id.nullable(),
  name: text(80).min(1, 'El nombre es obligatorio'),
  kind: LocationKind.default('other'),
  sortOrder: z.number().int().default(0),
});
export type LocationCreate = z.input<typeof LocationCreate>;

// ---------- Modificación (parciales con versión base) ----------
/**
 * Esquema de modificación parcial. OJO: en Zod 4 `.partial()` sigue aplicando los `.default()`,
 * lo que haría que un PATCH de un solo campo «resetease» los demás. Por eso se quitan los defaults.
 */
type NoDefault<S> = S extends z.ZodDefault<infer I> ? I : S;
const patchOf = <T extends z.ZodRawShape>(fields: z.ZodObject<T>) => {
  const shape = Object.fromEntries(
    Object.entries(fields.shape).map(([k, v]) => [
      k,
      (v instanceof z.ZodDefault ? (v.unwrap() as z.ZodType) : (v as z.ZodType)).optional(),
    ]),
  ) as { [K in keyof T]: z.ZodOptional<NoDefault<T[K]> & z.ZodType> };
  return z.object({ baseVersion: z.number().int().min(1), fields: z.object(shape) });
};

export const WorkPatch = patchOf(WorkFields);
export const EditionPatch = patchOf(EditionFields);
export const CopyPatch = patchOf(
  CopyFields.extend({
    status: z.enum(['active', 'retired']),
    retiredReason: RetireReason.nullable(),
  }),
);
export const LocationPatch = patchOf(
  z.object({
    parentId: Id.nullable(),
    name: text(80).min(1),
    kind: LocationKind,
    sortOrder: z.number().int(),
  }),
);
export type WorkPatch = z.input<typeof WorkPatch>;
export type EditionPatch = z.input<typeof EditionPatch>;
export type CopyPatch = z.input<typeof CopyPatch>;
export type LocationPatch = z.input<typeof LocationPatch>;

// ---------- Respuestas ----------
type Versioned = { id: string; version: number; createdAt: string; updatedAt: string };
export type WorkDTO = Versioned & z.infer<typeof WorkFields>;
export type EditionDTO = Versioned &
  z.infer<typeof EditionFields> & { workId: string; isbn10: string | null };
export type CopyDTO = Versioned &
  z.infer<typeof CopyFields> & {
    editionId: string;
    code: string;
    status: 'active' | 'retired';
    retiredReason: string | null;
    retiredOn: string | null;
    locationPath: string[];
  };
export type LocationDTO = Versioned & {
  parentId: string | null;
  name: string;
  kind: LocationKind;
  sortOrder: number;
  /** Ejemplares en esta ubicación y sus subdivisiones. */
  copyCount: number;
  /** Ejemplares colocados directamente aquí. */
  directCount: number;
};
export type LocationTree = { items: LocationDTO[]; unassigned: number };

export type WorkDetail = {
  work: WorkDTO;
  editions: (EditionDTO & { copies: CopyDTO[] })[];
};

export const LIBRARY_SORTS = ['title', 'author', 'acquired', 'location', 'added'] as const;
export const LibraryQuery = z.object({
  q: z.string().trim().max(200).optional(),
  /** id de ubicación (incluye subdivisiones) o "none" para los ejemplares sin ubicación. */
  location: z.union([Id, z.literal('none')]).optional(),
  subject: z.string().max(200).optional(),
  language: z.string().max(8).optional(),
  sort: z.enum(LIBRARY_SORTS).default('title'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type LibraryQuery = z.input<typeof LibraryQuery>;

export type LibraryItem = {
  editionId: string;
  workId: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  subjects: string[];
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  isbn13: string | null;
  coverAssetId: string | null;
  metadataStatus: 'complete' | 'provisional';
  editionCount: number;
  copies: { id: string; code: string; locationId: string | null; locationPath: string[] }[];
  lastAcquiredOn: string | null;
};
export type LibraryPage = { items: LibraryItem[]; total: number; tookMs: number };
export type LibraryFacets = { subjects: { name: string; count: number }[]; languages: string[] };

// ---------- Metadatos externos ----------
export type MetadataProposal = {
  title: string | null;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pages: number | null;
  subjects: string[];
  description: string | null;
  coverUrl: string | null;
};
export type LookupResult = {
  isbn13: string;
  isbn10: string | null;
  found: boolean;
  sources: string[];
  proposal: MetadataProposal | null;
  /** Si ya tienes esta edición: para ofrecer «añadir otro ejemplar» en vez de duplicar. */
  existing: { editionId: string; workId: string; title: string; copies: number } | null;
  /** Proveedores que fallaron (sin conexión, timeout…): el alta sigue siendo posible. */
  errors: string[];
};

export const FetchAssetRequest = z.object({ url: z.url() });
export type AssetDTO = { id: string; mime: string; width: number; height: number; bytes: number };

export type ConflictProblem = {
  currentVersion: number;
  conflicts: { field: string; current: unknown; yours: unknown }[];
};
