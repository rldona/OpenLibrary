/**
 * Metadata providers by text (title/author), used to identify a cover photo.
 * Their answers are PROPOSALS the user reviews: they are never stored directly in the catalog.
 *
 * Search results are work-level except Google Books volumes, so only Google Books carries an ISBN:
 * the ISBN of that exact volume, never a guess from an Open Library work.
 */
import { normalizeIsbn, type MetadataCandidate } from '@openlibrary/contracts';
import { clean, getJson, LANG3, yearOf, type Fetch } from './providers.js';

/** What a provider returns: no sources and not yet checked against the catalog. */
export type Candidate = Omit<MetadataCandidate, 'owned' | 'sources'>;
/** A merged candidate with the providers that returned it. */
export type SourcedCandidate = Omit<MetadataCandidate, 'owned'>;
export type SearchQuery = { title: string | null; author: string | null };

const FIELDS = 'key,title,subtitle,author_name,first_publish_year,publisher,language,cover_i,edition_key';

const languageOf = (raw: unknown) => {
  const code = clean(raw);
  return code ? (LANG3[code] ?? code.slice(0, 2)) : null;
};

const namesOf = (raw: unknown) => (Array.isArray(raw) ? raw.map(clean).filter((x): x is string => !!x) : []);

const coverOf = (raw: unknown) => {
  const links = raw as Record<string, string> | undefined;
  const img = links?.thumbnail ?? links?.smallThumbnail;
  return img ? img.replace(/^http:/, 'https:').replace('&edge=curl', '') : null;
};

/** Open Library: works with covers. Never sets isbn13 (its ids mix editions). */
export async function openLibrarySearch(fetchImpl: Fetch, query: SearchQuery): Promise<Candidate[]> {
  const params = new URLSearchParams({ limit: '10', fields: FIELDS });
  if (query.title) params.set('title', query.title);
  if (query.author) params.set('author', query.author);
  const data = (await getJson(fetchImpl, `https://openlibrary.org/search.json?${params.toString()}`)) as {
    docs?: Record<string, unknown>[];
  };

  return (data.docs ?? []).flatMap((doc) => {
    const title = clean(doc.title);
    if (!title) return [];
    const coverId = typeof doc.cover_i === 'number' ? doc.cover_i : null;
    return [
      {
        title,
        subtitle: clean(doc.subtitle),
        authors: namesOf(doc.author_name),
        publisher: Array.isArray(doc.publisher) ? clean(doc.publisher[0]) : null,
        publishedYear:
          typeof doc.first_publish_year === 'number'
            ? doc.first_publish_year
            : yearOf(doc.first_publish_year),
        language: Array.isArray(doc.language) ? languageOf(doc.language[0]) : null,
        isbn13: null,
        coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null,
      },
    ];
  });
}

/** Google's fielded search trips over cover punctuation ("¿", "?"), so only letters and digits go in. */
const fieldValue = (value: string) =>
  value
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Google Books: the exact volume, with its ISBN and a thumbnail. */
export async function googleBooksSearch(fetchImpl: Fetch, query: SearchQuery): Promise<Candidate[]> {
  const title = query.title ? fieldValue(query.title) : '';
  const author = query.author ? fieldValue(query.author) : '';
  const q = [title ? `intitle:${title}` : '', author ? `inauthor:${author}` : ''].filter(Boolean).join(' ');
  const params = new URLSearchParams({ q, maxResults: '10', printType: 'books' });
  const data = (await getJson(
    fetchImpl,
    `https://www.googleapis.com/books/v1/volumes?${params.toString()}`,
  )) as { items?: { volumeInfo?: Record<string, unknown> }[] };

  return (data.items ?? []).flatMap((item) => {
    const v = item.volumeInfo;
    const title = clean(v?.title);
    if (!v || !title) return [];

    const ids = Array.isArray(v.industryIdentifiers)
      ? (v.industryIdentifiers as { type?: unknown; identifier?: unknown }[])
      : [];
    const rawIsbn =
      ids.find((i) => i.type === 'ISBN_13')?.identifier ?? ids.find((i) => i.type === 'ISBN_10')?.identifier;
    const isbn = typeof rawIsbn === 'string' ? normalizeIsbn(rawIsbn) : { ok: false as const };
    const lang = clean(v.language);

    return [
      {
        title,
        subtitle: clean(v.subtitle),
        authors: namesOf(v.authors),
        publisher: clean(v.publisher),
        publishedYear: yearOf(v.publishedDate),
        language: lang ? (LANG3[lang] ?? lang.slice(0, 2)) : null,
        isbn13: isbn.ok ? isbn.isbn13 : null,
        coverUrl: coverOf(v.imageLinks),
      },
    ];
  });
}

export const SEARCH_PROVIDERS = [
  { name: 'Open Library', run: openLibrarySearch },
  { name: 'Google Books', run: googleBooksSearch },
] as const;

/** Lowercase, accent- and punctuation-insensitive text used for matching. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Only merges the same edition: both must carry the same ISBN. Understanding the same title and
 * author across providers would graft a Google Books edition's ISBN onto an Open Library work
 * (and lose the other Open Library editions in the list), so candidates stay separate.
 */
const sameCandidate = (a: Candidate, b: Candidate) => !!a.isbn13 && a.isbn13 === b.isbn13;

const isEmpty = (value: unknown) => value === null || (Array.isArray(value) && value.length === 0);

function mergeInto(base: Candidate, extra: Candidate): Candidate {
  const out: Candidate = { ...base };
  for (const key of Object.keys(out) as (keyof Candidate)[]) {
    if (isEmpty(out[key]) && !isEmpty(extra[key])) {
      (out as Record<string, unknown>)[key] = extra[key];
    }
  }
  return out;
}

/**
 * Merges the same edition returned by both providers (same ISBN: union of sources, filling gaps).
 * Different editions of the same work stay separate so the user can pick the cover they hold.
 */
export function mergeCandidates(items: { source: string; candidate: Candidate }[]): SourcedCandidate[] {
  const entries: { candidate: Candidate; sources: string[] }[] = [];
  for (const { source, candidate } of items) {
    const target = entries.find((e) => !e.sources.includes(source) && sameCandidate(e.candidate, candidate));
    if (target) {
      target.candidate = mergeInto(target.candidate, candidate);
      target.sources.push(source);
    } else {
      entries.push({ candidate: { ...candidate }, sources: [source] });
    }
  }
  return entries.map((e) => ({ ...e.candidate, sources: [...e.sources] }));
}

/** Edit distance between two short words, capped: OCR misreads a letter or two ("fntima" for "íntima"). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      best = Math.min(best, row[j]!);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/** Short words must match exactly; longer ones forgive one OCR slip (two from eight letters). */
function sameToken(token: string, wanted: string): boolean {
  if (token === wanted) return true;
  if (wanted.length < 4) return false;
  const max = wanted.length >= 8 ? 2 : 1;
  return editDistance(token, wanted, max) <= max;
}

function titleSimilarity(title: string, query: string): number {
  const normalized = normalizeText(title);
  if (!query) return 0;
  if (normalized === query) return 2;
  const tokens = normalized.split(' ').filter(Boolean);
  const wanted = query.split(' ').filter(Boolean);
  if (!wanted.length) return 0;
  return wanted.filter((w) => tokens.some((t) => sameToken(t, w))).length / wanted.length;
}

/** Deterministic ranking: title match, author bonus, cover and ISBN as tie-breakers. */
export function rankCandidates(
  candidates: SourcedCandidate[],
  query: SearchQuery,
  limit = 8,
): SourcedCandidate[] {
  const wantedTitle = query.title ? normalizeText(query.title) : '';
  const wantedAuthor = query.author ? normalizeText(query.author) : '';
  const scored = candidates.map((candidate, index) => {
    const author = normalizeText(candidate.authors.join(' '));
    const score =
      titleSimilarity(candidate.title, wantedTitle) +
      (wantedAuthor && author.includes(wantedAuthor) ? 0.5 : 0);
    return { candidate, index, score };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(!!b.candidate.coverUrl) - Number(!!a.candidate.coverUrl) ||
      Number(!!b.candidate.isbn13) - Number(!!a.candidate.isbn13) ||
      a.index - b.index,
  );
  return scored.slice(0, limit).map((s) => s.candidate);
}

export type SearchCandidatesResult = {
  candidates: SourcedCandidate[];
  /** Providers that answered, even with no results. */
  sources: string[];
  /** Providers that failed, as `Name: message`. */
  errors: string[];
};

async function runProviders(fetchImpl: Fetch, query: SearchQuery) {
  const settled = await Promise.allSettled(
    SEARCH_PROVIDERS.map((provider) => provider.run(fetchImpl, query)),
  );
  const items: { source: string; candidate: Candidate }[] = [];
  const sources: string[] = [];
  const errors: string[] = [];
  settled.forEach((result, i) => {
    const name = SEARCH_PROVIDERS[i]!.name;
    if (result.status === 'fulfilled') {
      sources.push(name);
      items.push(...result.value.map((candidate) => ({ source: name, candidate })));
    } else {
      errors.push(`${name}: ${result.reason instanceof Error ? result.reason.message : 'error'}`);
    }
  });
  return { items, sources, errors };
}

const unique = (values: string[]) => [...new Set(values)];

/**
 * Searches both providers. If title+author finds nothing and an author was given, retries once with
 * the title alone and the author alone at the same time: cover text may add a name the catalog spells
 * differently, and OCR often misreads a letter of the title ("La resistencia fntima"), which the
 * providers' exact search never matches. The author's works are then ranked by a typo-tolerant title
 * match, so the book on the cover comes first.
 */
export async function searchCandidates(
  fetchImpl: Fetch,
  query: SearchQuery,
): Promise<SearchCandidatesResult> {
  const first = await runProviders(fetchImpl, query);

  // Retrying is only worth it when a provider answered with nothing: if every provider failed, the
  // second round would spend another 6 s and the client has already given up.
  if (!first.items.length && query.title && query.author && first.sources.length) {
    const rounds = await Promise.all([
      runProviders(fetchImpl, { title: query.title, author: null }),
      runProviders(fetchImpl, { title: null, author: query.author }),
    ]);
    const sources = unique(rounds.flatMap((r) => r.sources));
    // The same work can come back from both retries of one provider: keep it once.
    const seen = new Set<string>();
    const items = rounds
      .flatMap((r) => r.items)
      .filter((item) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return {
      candidates: rankCandidates(mergeCandidates(items), query),
      sources,
      // A provider that answered one of the two retries did not fail.
      errors: unique(rounds.flatMap((r) => r.errors)).filter(
        (e) => !sources.some((s) => e.startsWith(`${s}:`)),
      ),
    };
  }

  return {
    candidates: rankCandidates(mergeCandidates(first.items), query),
    sources: first.sources,
    errors: first.errors,
  };
}
