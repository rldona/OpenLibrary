import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  normalizeIsbn,
  type LocationDTO,
  type LocationTree,
  type WishDTO,
  type WorkDetail,
} from '@openlibrary/contracts';
import { api } from '../api';

export const keys = {
  library: ['library'] as const,
  facets: ['facets'] as const,
  locations: ['locations'] as const,
  work: (id: string) => ['work', id] as const,
  wishlist: ['wishlist'] as const,
  stats: ['stats'] as const,
};

export const useLocations = () => useQuery({ queryKey: keys.locations, queryFn: api.locations });
export const useFacets = () => useQuery({ queryKey: keys.facets, queryFn: api.facets });
export const useWishlist = () => useQuery({ queryKey: keys.wishlist, queryFn: api.wishlist });

/** BR15: the open wish a new book fulfils, by explicit id ("I bought it") or by its ISBN. */
export function matchingWish(
  wishes: WishDTO[] | undefined,
  wishId: string | undefined,
  isbn: string,
): WishDTO | undefined {
  const open = wishes?.filter((w) => w.status === 'open') ?? [];
  if (wishId) return open.find((w) => w.id === wishId);
  const n = normalizeIsbn(isbn);
  return n.ok ? open.find((w) => w.isbn13 === n.isbn13) : undefined;
}

/** Marks a wish as bought, linked to the copy that fulfilled it (the wish is kept as history). */
export const acquireWish = (w: WishDTO, copyId: string) =>
  api.patchWish(w.id, { baseVersion: w.version, fields: { status: 'acquired', acquiredCopyId: copyId } });
export const useWork = (id: string | null) =>
  useQuery({ queryKey: keys.work(id ?? ''), queryFn: () => api.work(id!), enabled: !!id });

/** After any catalog change: refresh the listing, facets and locations (counts). */
export function invalidateCatalog(qc: QueryClient, work?: WorkDetail) {
  if (work) qc.setQueryData(keys.work(work.work.id), work);
  void qc.invalidateQueries({ queryKey: keys.library });
  void qc.invalidateQueries({ queryKey: keys.facets });
  void qc.invalidateQueries({ queryKey: keys.locations });
  void qc.invalidateQueries({ queryKey: keys.wishlist });
  void qc.invalidateQueries({ queryKey: keys.stats });
}
export const useInvalidate = () => {
  const qc = useQueryClient();
  return (work?: WorkDetail) => invalidateCatalog(qc, work);
};

/** Locations in depth-first order with their full path (for selects). */
export function flattenLocations(
  tree: LocationTree | undefined,
): (LocationDTO & { path: string[]; depth: number })[] {
  if (!tree) return [];
  const children = new Map<string | null, LocationDTO[]>();
  for (const l of tree.items) children.set(l.parentId, [...(children.get(l.parentId) ?? []), l]);
  const out: (LocationDTO & { path: string[]; depth: number })[] = [];
  const walk = (parent: string | null, path: string[]) => {
    for (const l of children.get(parent) ?? []) {
      const p = [...path, l.name];
      out.push({ ...l, path: p, depth: p.length - 1 });
      walk(l.id, p);
    }
  };
  walk(null, []);
  return out;
}

/** Readable path that omits the root ("Home") when it is the only root: shorter and clearer. */
export function shortPath(path: string[], tree: LocationTree | undefined): string {
  const roots = tree?.items.filter((l) => !l.parentId).length ?? 0;
  const p = roots === 1 && path.length > 1 ? path.slice(1) : path;
  return p.join(' › ');
}
