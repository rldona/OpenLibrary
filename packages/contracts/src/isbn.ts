/** Normalización y validación de ISBN (compartido por servidor, web y — portado — Android). */

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

export type IsbnResult = { ok: true; isbn13: string; isbn10: string | null } | { ok: false; reason: string };

/** Acepta ISBN-10/13 con o sin guiones/espacios. Rechaza ISSN (977), ISMN (9790) y EAN de producto. */
export function normalizeIsbn(raw: string): IsbnResult {
  const c = raw.toUpperCase().replace(/[^0-9X]/g, '');
  if (c.length === 13) {
    if (c.startsWith('977'))
      return { ok: false, reason: 'Es un ISSN (revista o publicación periódica), no un ISBN.' };
    if (c.startsWith('9790')) return { ok: false, reason: 'Es un ISMN (partitura), no un ISBN.' };
    if (!/^97[89]\d{10}$/.test(c))
      return { ok: false, reason: 'Es un código de producto (EAN), no un ISBN.' };
    if (check13(c.slice(0, 12)) !== c[12]) return { ok: false, reason: 'Dígito de control incorrecto.' };
    return { ok: true, isbn13: c, isbn10: isbn13to10(c) };
  }
  if (c.length === 10) {
    if (!/^\d{9}[\dX]$/.test(c)) return { ok: false, reason: 'ISBN-10 con formato inválido.' };
    let s = 0;
    for (let i = 0; i < 10; i++) s += (c[i] === 'X' ? 10 : Number(c[i])) * (10 - i);
    if (s % 11) return { ok: false, reason: 'Dígito de control incorrecto.' };
    const p12 = '978' + c.slice(0, 9);
    return { ok: true, isbn13: p12 + check13(p12), isbn10: c };
  }
  return { ok: false, reason: 'Longitud no válida: se esperan 10 o 13 dígitos.' };
}

/** 978-84-9759-246-8 (agrupación aproximada; solo para mostrar). */
export const formatIsbn = (isbn13: string) =>
  isbn13.length === 13
    ? `${isbn13.slice(0, 3)}-${isbn13.slice(3, 5)}-${isbn13.slice(5, 9)}-${isbn13.slice(9, 12)}-${isbn13[12]}`
    : isbn13;

/** Construye un ISBN-13 válido a partir de 12 dígitos (útil para datos de prueba). */
export const withCheckDigit = (p12: string) => p12 + check13(p12);
