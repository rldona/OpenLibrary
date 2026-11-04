/**
 * Internationalisation core shared by the server, the web app and (ported) the Android app.
 * Supported languages: English (default) and Spanish.
 *
 * Messages are referenced by key (e.g. `isbn.issn`) and interpolate `{name}` placeholders.
 * Schemas and errors carry keys, never translated text, so each client renders them in its own language.
 */

export const LANGS = ['en', 'es'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';

/** Picks the best supported language from an Accept-Language header (or a bare code like "es-ES"). */
export function pickLang(header: string | null | undefined): Lang {
  if (!header) return DEFAULT_LANG;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: (tag ?? '').toLowerCase(), q: q ? Number(q.trim().slice(2)) || 0 : 1 };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split('-')[0] as Lang;
    if ((LANGS as readonly string[]).includes(base)) return base;
  }
  return DEFAULT_LANG;
}

export type Params = Record<string, string | number>;
export type Dict = Record<string, string>;

export const interpolate = (s: string, params: Params = {}) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));

/** Builds a translator over one or more dictionaries (later ones override earlier ones). */
export function translator(dicts: Record<Lang, Dict>[], lang: Lang) {
  const merged: Dict = Object.assign({}, ...dicts.map((d) => d[DEFAULT_LANG]), ...dicts.map((d) => d[lang]));
  return (key: string, params?: Params) => interpolate(merged[key] ?? key, params);
}

/** Messages shared by every client: validation, ISBN and catalog labels. */
export const SHARED: Record<Lang, Dict> = {
  en: {
    'isbn.issn': 'This is an ISSN (magazine or periodical), not an ISBN.',
    'isbn.ismn': 'This is an ISMN (sheet music), not an ISBN.',
    'isbn.ean': 'This is a product barcode (EAN), not an ISBN.',
    'isbn.checksum': 'Wrong check digit.',
    'isbn.format': 'Invalid ISBN-10 format.',
    'isbn.length': 'Invalid length: 10 or 13 digits expected.',
    'validation.titleRequired': 'The title is required.',
    'validation.nameRequired': 'The name is required.',
    'validation.invalidId': 'Invalid id.',
    'validation.invalidAssetId': 'Invalid image id.',
    'validation.invalidDate': 'Use the YYYY-MM-DD date format.',
    'validation.workOrWorkId': 'Provide either an existing work (workId) or a new one (work).',
    'condition.new': 'As new',
    'condition.fine': 'Fine',
    'condition.good': 'Good',
    'condition.used': 'Used',
    'condition.fair': 'Fair',
    'condition.poor': 'Poor',
    'retire.gifted': 'Given away',
    'retire.sold': 'Sold',
    'retire.lost': 'Lost',
    'retire.damaged': 'Damaged',
    'retire.other': 'Other',
    'locationKind.home': 'Home',
    'locationKind.room': 'Room',
    'locationKind.bookcase': 'Bookcase / unit',
    'locationKind.shelf': 'Shelf',
    'locationKind.box': 'Box',
    'locationKind.other': 'Other',
    'entity.work': 'book',
    'entity.edition': 'edition',
    'entity.copy': 'copy',
    'entity.location': 'location',
  },
  es: {
    'isbn.issn': 'Es un ISSN (revista o publicación periódica), no un ISBN.',
    'isbn.ismn': 'Es un ISMN (partitura), no un ISBN.',
    'isbn.ean': 'Es un código de producto (EAN), no un ISBN.',
    'isbn.checksum': 'Dígito de control incorrecto.',
    'isbn.format': 'ISBN-10 con formato inválido.',
    'isbn.length': 'Longitud no válida: se esperan 10 o 13 dígitos.',
    'validation.titleRequired': 'El título es obligatorio.',
    'validation.nameRequired': 'El nombre es obligatorio.',
    'validation.invalidId': 'Identificador no válido.',
    'validation.invalidAssetId': 'Identificador de imagen no válido.',
    'validation.invalidDate': 'Usa el formato de fecha AAAA-MM-DD.',
    'validation.workOrWorkId': 'Indica una obra existente (workId) o una nueva (work).',
    'condition.new': 'Como nuevo',
    'condition.fine': 'Excelente',
    'condition.good': 'Bueno',
    'condition.used': 'Usado',
    'condition.fair': 'Aceptable',
    'condition.poor': 'Deteriorado',
    'retire.gifted': 'Regalado',
    'retire.sold': 'Vendido',
    'retire.lost': 'Perdido',
    'retire.damaged': 'Deteriorado',
    'retire.other': 'Otro',
    'locationKind.home': 'Vivienda',
    'locationKind.room': 'Habitación',
    'locationKind.bookcase': 'Estantería / mueble',
    'locationKind.shelf': 'Balda',
    'locationKind.box': 'Caja',
    'locationKind.other': 'Otro',
    'entity.work': 'libro',
    'entity.edition': 'edición',
    'entity.copy': 'ejemplar',
    'entity.location': 'ubicación',
  },
};
