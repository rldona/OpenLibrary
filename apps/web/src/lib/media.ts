/**
 * Window-size classes, as the Android app's (ui/components/Adaptive.kt): a bottom navigation bar below
 * 600 px, a navigation rail up to 1199 px and the side menu from 1200 px. The CSS follows the class the
 * shell puts on `.app` (`nav-bar`, `nav-rail`, `nav-drawer`); dialogs use the same 600 px in styles.css.
 */
import { useSyncExternalStore } from 'react';

export type NavMode = 'bar' | 'rail' | 'drawer';
export const COMPACT_QUERY = '(max-width: 599.98px)';
export const EXPANDED_QUERY = '(min-width: 1200px)';

const queries = () =>
  typeof window.matchMedia === 'function'
    ? [window.matchMedia(COMPACT_QUERY), window.matchMedia(EXPANDED_QUERY)]
    : [];

function snapshot(): NavMode {
  const [compact, expanded] = queries();
  if (!compact || !expanded) return 'drawer';
  return compact.matches ? 'bar' : expanded.matches ? 'drawer' : 'rail';
}

function subscribe(cb: () => void) {
  const qs = queries();
  qs.forEach((q) => q.addEventListener('change', cb));
  return () => qs.forEach((q) => q.removeEventListener('change', cb));
}

export const useNavMode = () => useSyncExternalStore(subscribe, snapshot);
