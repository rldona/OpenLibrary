import { eq } from 'drizzle-orm';
import { normalizeIsbn, type LookupResult, type MetadataProposal } from '@openlibrary/contracts';
import type { Db } from '../db/client.js';
import { lookupCache } from '../db/schema.js';
import { badRequest } from '../errors.js';
import type { Clock } from '../auth/service.js';
import type { CatalogService } from '../catalog/service.js';
import { mergeProposals, PROVIDERS, type Fetch } from './providers.js';

const FOUND_TTL_MS = 30 * 24 * 3600_000;
const MISS_TTL_MS = 24 * 3600_000;

type Cached = { sources: string[]; proposal: MetadataProposal | null };

export class LookupService {
  constructor(
    private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: Clock = () => new Date(),
  ) {}

  async byIsbn(raw: string, opts: { refresh?: boolean } = {}): Promise<LookupResult> {
    const n = normalizeIsbn(raw);
    if (!n.ok) throw badRequest(`isbn.${n.reason}`);
    const existing = this.catalog.findByIsbn(n.isbn13);
    const base = { isbn13: n.isbn13, isbn10: n.isbn10, existing };

    const cached = this.db.select().from(lookupCache).where(eq(lookupCache.isbn13, n.isbn13)).get();
    if (cached && !opts.refresh) {
      const p = cached.payload as Cached;
      const age = this.now().getTime() - new Date(cached.fetchedAt).getTime();
      if (age < (p.proposal ? FOUND_TTL_MS : MISS_TTL_MS)) {
        return { ...base, found: !!p.proposal, sources: p.sources, proposal: p.proposal, errors: [] };
      }
    }

    const settled = await Promise.allSettled(PROVIDERS.map((p) => p.run(this.fetchImpl, n.isbn13)));
    const found: { name: string; p: MetadataProposal }[] = [];
    const errors: string[] = [];
    settled.forEach((r, i) => {
      const name = PROVIDERS[i]!.name;
      if (r.status === 'fulfilled') {
        if (r.value) found.push({ name, p: r.value });
      } else errors.push(`${name}: ${r.reason instanceof Error ? r.reason.message : 'error'}`);
    });
    const proposal = mergeProposals(found.map((f) => f.p));
    const sources = found.map((f) => f.name);

    // Only cache when every provider answered (a network failure is not a "not found").
    if (!errors.length) {
      const payload: Cached = { sources, proposal };
      const fetchedAt = this.now().toISOString();
      this.db
        .insert(lookupCache)
        .values({ isbn13: n.isbn13, payload, fetchedAt })
        .onConflictDoUpdate({ target: lookupCache.isbn13, set: { payload, fetchedAt } })
        .run();
    }
    return { ...base, found: !!proposal, sources, proposal, errors };
  }
}
