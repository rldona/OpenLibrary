/** ISBN normalisation and validation (shared by server and web; ported to Android). */

const check13 = (p12: string): string => {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(p12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
};

export function isbn13to10(isbn13: string): string | null {
  if (!isbn13.startsWith('978')) return null;
  const body = isbn13.slice(3, 12);
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(body[i]) * (10 - i);
  const d = (11 - (s % 11)) % 11;
  return body + (d === 10 ? 'X' : String(d));
}

/** Why a code is not a valid ISBN. Translate with the `isbn.<reason>` message key. */
export type IsbnError = 'issn' | 'ismn' | 'ean' | 'checksum' | 'format' | 'length';

export type IsbnResult =
  { ok: true; isbn13: string; isbn10: string | null } | { ok: false; reason: IsbnError };

/** Accepts ISBN-10/13 with or without hyphens/spaces. Rejects ISSN (977), ISMN (9790) and product EANs. */
export function normalizeIsbn(raw: string): IsbnResult {
  const c = raw.toUpperCase().replace(/[^0-9X]/g, '');
  if (c.length === 13) {
    if (c.startsWith('977')) return { ok: false, reason: 'issn' };
    if (c.startsWith('9790')) return { ok: false, reason: 'ismn' };
    if (!/^97[89]\d{10}$/.test(c)) return { ok: false, reason: 'ean' };
    if (check13(c.slice(0, 12)) !== c[12]) return { ok: false, reason: 'checksum' };
    return { ok: true, isbn13: c, isbn10: isbn13to10(c) };
  }
  if (c.length === 10) {
    if (!/^\d{9}[\dX]$/.test(c)) return { ok: false, reason: 'format' };
    let s = 0;
    for (let i = 0; i < 10; i++) s += (c[i] === 'X' ? 10 : Number(c[i])) * (10 - i);
    if (s % 11) return { ok: false, reason: 'checksum' };
    const p12 = '978' + c.slice(0, 9);
    return { ok: true, isbn13: p12 + check13(p12), isbn10: c };
  }
  return { ok: false, reason: 'length' };
}

/** 978-84-9759-246-8 (approximate grouping; display only). */
export const formatIsbn = (isbn13: string) =>
  isbn13.length === 13
    ? `${isbn13.slice(0, 3)}-${isbn13.slice(3, 5)}-${isbn13.slice(5, 9)}-${isbn13.slice(9, 12)}-${isbn13[12]}`
    : isbn13;

/** Builds a valid ISBN-13 from 12 digits (handy for test data). */
export const withCheckDigit = (p12: string) => p12 + check13(p12);
