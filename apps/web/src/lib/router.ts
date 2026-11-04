/**
 * Router mínimo sobre la History API: ruta + parámetros de búsqueda.
 * La ficha de un libro es un parámetro (?libro=<obra>&ed=<edición>) para poder abrirla sobre cualquier vista.
 */
import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
window.addEventListener('popstate', notify);

const snapshot = () => location.pathname + location.search;

export function useLocation() {
  const href = useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, snapshot);
  const url = new URL(href, location.origin);
  return { path: url.pathname, params: url.searchParams };
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === snapshot()) return;
  history[opts.replace ? 'replaceState' : 'pushState'](null, '', to);
  notify();
}

/** Cambia parámetros de la URL actual (undefined/'' los elimina). */
export function setParams(patch: Record<string, string | undefined>, opts: { replace?: boolean } = {}) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '') url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  navigate(url.pathname + url.search, opts);
}

export const openBook = (workId: string, editionId?: string) => setParams({ libro: workId, ed: editionId });
export const closeBook = () => setParams({ libro: undefined, ed: undefined });
