/**
 * Metadata providers by ISBN. Their answers are PROPOSALS the user reviews:
 * they are never stored directly in the catalog.
 */
import type { MetadataProposal } from '@openlibrary/contracts';

export type Fetch = typeof fetch;
const UA = 'OpenLibrary-personal/0.1 (self-hosted personal library)';
const TIMEOUT_MS = 6000;

export const yearOf = (s: unknown) => {
  const m = typeof s === 'string' ? s.match(/\b(1[4-9]\d\d|20\d\d)\b/) : null;
  return m ? Number(m[1]) : null;
};
export const clean = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim() : null);
export const LANG3: Record<string, string> = {
  spa: 'es',
  eng: 'en',
  fre: 'fr',
  fra: 'fr',
  ita: 'it',
  por: 'pt',
  ger: 'de',
  deu: 'de',
  cat: 'ca',
};

export async function getJson(fetchImpl: Fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Open Library: good coverage of covers and editions; no synopsis in this API. */
export async function openLibrary(fetchImpl: Fetch, isbn13: string): Promise<MetadataProposal | null> {
  const data = (await getJson(
    fetchImpl,
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`,
  )) as Record<string, Record<string, unknown>>;
  const b = data[`ISBN:${isbn13}`];
  if (!b) return null;
  const names = (v: unknown) =>
    Array.isArray(v)
      ? v.map((x) => clean((x as { name?: unknown }).name)).filter((x): x is string => !!x)
      : [];
  const cover = b.cover as { large?: string; medium?: string } | undefined;
  return {
    title: clean(b.title),
    subtitle: clean(b.subtitle),
    authors: names(b.authors),
    publisher: names(b.publishers)[0] ?? null,
    publishedYear: yearOf(b.publish_date),
    language: null,
    pages: typeof b.number_of_pages === 'number' ? b.number_of_pages : null,
    subjects: names(b.subjects).slice(0, 5),
    description: null,
    coverUrl: cover?.large ?? cover?.medium ?? null,
  };
}

/** Google Books: adds synopsis, language and categories; complements Open Library. */
export async function googleBooks(fetchImpl: Fetch, isbn13: string): Promise<MetadataProposal | null> {
  const data = (await getJson(
    fetchImpl,
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}&maxResults=1`,
  )) as { items?: { volumeInfo?: Record<string, unknown> }[] };
  const v = data.items?.[0]?.volumeInfo;
  if (!v) return null;
  const links = v.imageLinks as Record<string, string> | undefined;
  const img = links?.thumbnail ?? links?.smallThumbnail;
  const lang = clean(v.language);
  return {
    title: clean(v.title),
    subtitle: clean(v.subtitle),
    authors: Array.isArray(v.authors)
      ? (v.authors as unknown[]).map(clean).filter((x): x is string => !!x)
      : [],
    publisher: clean(v.publisher),
    publishedYear: yearOf(v.publishedDate),
    language: lang ? (LANG3[lang] ?? lang.slice(0, 2)) : null,
    pages: typeof v.pageCount === 'number' && v.pageCount > 0 ? v.pageCount : null,
    subjects: Array.isArray(v.categories)
      ? (v.categories as unknown[]).map(clean).filter((x): x is string => !!x)
      : [],
    description: clean(v.description),
    coverUrl: img ? img.replace(/^http:/, 'https:').replace('&edge=curl', '') : null,
  };
}

/** Merges proposals: the first source wins and later ones fill the gaps. */
export function mergeProposals(list: MetadataProposal[]): MetadataProposal | null {
  if (!list.length) return null;
  const out = { ...list[0]! };
  for (const p of list.slice(1)) {
    for (const k of Object.keys(out) as (keyof MetadataProposal)[]) {
      const cur = out[k];
      const empty = cur === null || (Array.isArray(cur) && cur.length === 0);
      if (empty && p[k] !== null) (out as Record<string, unknown>)[k] = p[k];
    }
  }
  return out;
}

export const PROVIDERS = [
  { name: 'Open Library', run: openLibrary },
  { name: 'Google Books', run: googleBooks },
] as const;
