/**
 * The tab's title: "<what is shown> · OpenLibrary". A view sets level 0 and an open panel level 1, so the
 * panel's title wins while it is open and the view's comes back when it closes.
 */
import { useEffect } from 'react';

const APP = 'OpenLibrary';
const entries = new Map<symbol, { title: string; level: number; seq: number }>();
let seq = 0;

function apply() {
  const top = [...entries.values()].sort((a, b) => b.level - a.level || b.seq - a.seq)[0];
  document.title = top ? `${top.title} · ${APP}` : APP;
}

export function useDocumentTitle(title: string | null | undefined, level = 0) {
  useEffect(() => {
    if (!title) return;
    const key = Symbol(title);
    entries.set(key, { title, level, seq: seq++ });
    apply();
    return () => {
      entries.delete(key);
      apply();
    };
  }, [title, level]);
}
