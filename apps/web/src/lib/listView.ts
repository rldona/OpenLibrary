/**
 * The covers/table choice of a list, remembered across visits and navigation.
 *
 * The URL keeps it too (so a link can open a view), but navigating to another page drops the query
 * string; localStorage is what makes the preference survive coming back to the list.
 */
import { useEffect, useState } from 'react';
import { setParams, useLocation } from './router';

export type ListView = 'grid' | 'table';

const PREFIX = 'openlibrary.view.';

function stored(key: string, fallback: ListView): ListView {
  try {
    const value = localStorage.getItem(PREFIX + key);
    return value === 'grid' || value === 'table' ? value : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, view: ListView) {
  try {
    localStorage.setItem(PREFIX + key, view);
  } catch {
    // A browser without storage simply forgets it.
  }
}

export function useListView(key: string, fallback: ListView = 'grid'): [ListView, (view: ListView) => void] {
  const { params } = useLocation();
  const param = params.get('view');
  const [saved, setSaved] = useState<ListView>(() =>
    param === 'grid' || param === 'table' ? param : stored(key, fallback),
  );

  // A view in the URL wins (a shared link) and becomes the new preference. Without it, switching to
  // another list (another key) loads that list's own saved view.
  useEffect(() => {
    if (param === 'grid' || param === 'table') {
      setSaved(param);
      remember(key, param);
    } else {
      setSaved(stored(key, fallback));
    }
  }, [fallback, key, param]);

  const view = param === 'grid' || param === 'table' ? param : saved;
  const set = (next: ListView) => {
    setSaved(next);
    remember(key, next);
    setParams({ view: next }, { replace: true });
  };
  return [view, set];
}
