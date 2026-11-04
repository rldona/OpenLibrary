import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { LocationDTO, LocationTree, WorkDetail } from '@openlibrary/contracts';
import { api } from '../api';

export const keys = {
  library: ['library'] as const,
  facets: ['facets'] as const,
  locations: ['locations'] as const,
  work: (id: string) => ['work', id] as const,
};

export const useLocations = () => useQuery({ queryKey: keys.locations, queryFn: api.locations });
export const useFacets = () => useQuery({ queryKey: keys.facets, queryFn: api.facets });
export const useWork = (id: string | null) =>
  useQuery({ queryKey: keys.work(id ?? ''), queryFn: () => api.work(id!), enabled: !!id });

/** Tras cualquier cambio en el catálogo: refrescar listado, facetas y ubicaciones (conteos). */
export function invalidateCatalog(qc: QueryClient, work?: WorkDetail) {
  if (work) qc.setQueryData(keys.work(work.work.id), work);
  void qc.invalidateQueries({ queryKey: keys.library });
  void qc.invalidateQueries({ queryKey: keys.facets });
  void qc.invalidateQueries({ queryKey: keys.locations });
}
export const useInvalidate = () => {
  const qc = useQueryClient();
  return (work?: WorkDetail) => invalidateCatalog(qc, work);
};

/** Ubicaciones ordenadas en profundidad con su ruta completa (para selectores). */
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

/** Ruta legible omitiendo la raíz «Casa» si es la única raíz (más corta y más clara). */
export function shortPath(path: string[], tree: LocationTree | undefined): string {
  const roots = tree?.items.filter((l) => !l.parentId).length ?? 0;
  const p = roots === 1 && path.length > 1 ? path.slice(1) : path;
  return p.join(' › ');
}
