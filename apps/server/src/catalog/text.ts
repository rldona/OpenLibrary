/** Text helpers to sort and search regardless of diacritics and case. */

export const fold = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Author sort key: surname (last word) + full name. "Leopoldo Alas «Clarín»" → "alas …". */
export function authorSortKey(authors: string[]): string {
  const first = authors[0];
  if (!first) return '￿';
  const clean = first.replace(/[«"(].*$/, '').trim();
  const parts = clean.split(/\s+/);
  return `${fold(parts[parts.length - 1])} ${fold(clean)}`;
}

/**
 * Turns what the user types into a safe FTS5 query:
 * every word is a prefix ("garc" → García) and all of them must match.
 * A hyphenated ISBN is compacted so it matches the stored ISBN.
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
