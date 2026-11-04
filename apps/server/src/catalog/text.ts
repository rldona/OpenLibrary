/** Utilidades de texto para ordenar y buscar sin depender de tildes ni mayúsculas. */

export const fold = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Clave de orden por autor: apellido (última palabra) + nombre completo. «Leopoldo Alas «Clarín»» → «alas …». */
export function authorSortKey(authors: string[]): string {
  const first = authors[0];
  if (!first) return '￿';
  const clean = first.replace(/[«"(].*$/, '').trim();
  const parts = clean.split(/\s+/);
  return `${fold(parts[parts.length - 1])} ${fold(clean)}`;
}

/**
 * Convierte lo que escribe el usuario en una consulta FTS5 segura:
 * cada palabra es un prefijo («garc» → García) y todas deben aparecer.
 * Un ISBN con guiones se compacta para que coincida con el ISBN guardado.
 */
export function ftsQuery(q: string): string | null {
  const isbnish = q.replace(/[\s-]/g, '');
  if (/^\d{9}[\dXx]$|^\d{13}$/.test(isbnish)) return `"${isbnish.toLowerCase()}"*`;
  const tokens = fold(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 12);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}
