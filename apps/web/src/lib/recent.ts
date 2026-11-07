/**
 * Recent searches, kept on this browser like the Android app keeps them on the phone: the newest first,
 * at most eight, without repeating one that differs only in case or accents.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'ol.recentSearches';
export const RECENT_MAX = 8;

/** Case- and accent-insensitive form, to compare searches. */
export const foldSearch = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim().replace(/\s+/g, ' ');

let cache: string[] | null = null;
const listeners = new Set<() => void>();

function read(): string[] {
  if (cache) return cache;
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    cache = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    // Unreadable or no storage (private mode): start empty.
    cache = [];
  }
  return cache;
}

function write(list: string[]) {
  cache = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not persisted; still kept for this visit.
  }
  listeners.forEach((l) => l());
}

export const recentSearches = () => read();

export function addRecentSearch(q: string) {
  const text = q.trim().replace(/\s+/g, ' ');
  if (!text) return;
  const key = foldSearch(text);
  write([text, ...read().filter((x) => foldSearch(x) !== key)].slice(0, RECENT_MAX));
}

export const removeRecentSearch = (q: string) => write(read().filter((x) => x !== q));
export const clearRecentSearches = () => write([]);

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Another tab changed them.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export const useRecentSearches = () => useSyncExternalStore(subscribe, read);
