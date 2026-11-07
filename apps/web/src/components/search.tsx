/**
 * The library search as a combobox (WAI-ARIA 1.2 pattern, list autocomplete): with an empty box the
 * list offers the recent searches; while typing, the first books that match. The focus stays in the box
 * and the arrows move through the options (aria-activedescendant).
 *  - Enter on a recent search runs it; on a book, opens it; with no option chosen, searches the library.
 *  - Escape closes the list, and a second Escape empties the box. Delete removes a recent search.
 *  - "/" anywhere outside a field jumps to the box.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { LibraryItem } from '@openlibrary/contracts/client';
import { api } from '../api';
import { keys } from '../lib/queries';
import { openBook } from '../lib/router';
import { addRecentSearch, clearRecentSearches, removeRecentSearch, useRecentSearches } from '../lib/recent';
import { useI18n } from '../i18n';
import { Cover, Icon } from './ui';

export const SEARCH_RESULTS = 6;
const DEBOUNCE_MS = 250;

type Option = { kind: 'recent'; q: string } | { kind: 'book'; item: LibraryItem };

export function SearchBox({
  value,
  onSearch,
  live,
}: {
  /** The search applied to the library (the URL's `q`). */
  value: string;
  /** Applies a search to the library. */
  onSearch: (q: string) => void;
  /** The library is on screen: typing filters it as you go, besides suggesting books. */
  live: boolean;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(value);
  const [debounced, setDebounced] = useState(value.trim());
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(undefined);
  const id = useId();
  const listId = `${id}-list`;
  const headId = `${id}-head`;
  const recents = useRecentSearches();

  // The URL wins (back/forward, "Clear filters"), except while you are typing in the box.
  useEffect(() => {
    if (document.activeElement !== input.current) {
      setText(value);
      setDebounced(value.trim());
    }
  }, [value]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Not while typing elsewhere, nor under a dialog (the box is inert then).
      if (
        e.key !== '/' ||
        /INPUT|TEXTAREA|SELECT/.test(target.tagName) ||
        target.isContentEditable ||
        document.querySelector('dialog[open]')
      )
        return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /** Drops a search still waiting for the debounce. */
  const cancelPending = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  // A search typed for one view must not land on another: leaving the library (or this component) drops it.
  useEffect(() => cancelPending, [live]);

  const typed = text.trim();
  const results = useQuery({
    queryKey: [...keys.library, 'search', debounced],
    queryFn: () => api.library({ q: debounced, limit: SEARCH_RESULTS }),
    enabled: debounced !== '',
    placeholderData: keepPreviousData,
  });
  const books = typed && results.data ? results.data.items : [];
  const options: Option[] = typed
    ? books.map((item) => ({ kind: 'book', item }))
    : recents.map((q) => ({ kind: 'recent', q }));
  const settled = !!typed && results.isSuccess && !results.isPlaceholderData && debounced === typed;
  const noResults = settled && !books.length;
  const expanded = open && (options.length > 0 || noResults);
  const current = expanded && active >= 0 && active < options.length ? active : -1;

  function schedule(q: string) {
    cancelPending();
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setDebounced(q);
      if (live) onSearch(q);
    }, DEBOUNCE_MS);
  }

  function setQuery(q: string) {
    setText(q);
    setActive(-1);
    schedule(q.trim());
  }

  /** Searches the library for `q` (and remembers it). */
  function submit(q: string) {
    cancelPending();
    const s = q.trim();
    setText(s);
    setDebounced(s);
    if (s) addRecentSearch(s);
    onSearch(s);
    setOpen(false);
  }

  function choose(o: Option) {
    if (o.kind === 'recent') return submit(o.q);
    addRecentSearch(typed);
    setOpen(false);
    openBook(o.item.workId, o.item.editionId);
  }

  function clear() {
    setText('');
    setActive(-1);
    cancelPending();
    setDebounced('');
    // Only the library's own search is cleared; elsewhere emptying the box goes nowhere.
    if (live) onSearch('');
    input.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Keys that confirm or move an input method's composition are not ours.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const n = options.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(n ? (e.key === 'ArrowDown' ? 0 : n - 1) : -1);
      } else if (n) {
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((current + step + n + (current < 0 && step < 0 ? 1 : 0)) % n);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current >= 0) choose(options[current]!);
      else submit(text);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (expanded) setOpen(false);
      else if (text) clear();
    } else if (e.key === 'Delete' && !text && current >= 0) {
      const o = options[current]!;
      if (o.kind === 'recent') {
        e.preventDefault();
        removeRecentSearch(o.q);
        setActive(Math.min(current, n - 2));
      }
    }
  }

  const optionId = (i: number) => `${id}-opt-${i}`;
  const status = !typed
    ? ''
    : noResults
      ? t('search.noResults')
      : settled
        ? t(books.length === 1 ? 'search.results.one' : 'search.results.other', { n: books.length })
        : '';

  return (
    <div
      className="search"
      ref={wrap}
      onBlur={(e) => {
        if (wrap.current?.contains(e.relatedTarget as Node | null)) return;
        setOpen(false);
        // Leaving the box with nothing pending: it shows the search that is applied again.
        if (timer.current === undefined) {
          setText(value);
          setDebounced(value.trim());
        }
      }}
    >
      <Icon name="search" size={17} />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label={t('search.label')}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={current >= 0 ? optionId(current) : undefined}
        autoComplete="off"
        enterKeyHint="search"
        value={text}
        placeholder={t('search.placeholder')}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {text ? (
        <button
          type="button"
          className="icon-btn search-clear"
          aria-label={t('search.clear')}
          onClick={clear}
        >
          <Icon name="x" size={16} />
        </button>
      ) : (
        <kbd aria-hidden>/</kbd>
      )}
      <div className="search-pop" hidden={!expanded}>
        <div className="search-head" id={headId}>
          {typed ? t('search.books') : t('search.recent')}
        </div>
        <ul role="listbox" id={listId} aria-labelledby={headId}>
          {options.map((o, i) => (
            <li
              key={o.kind === 'recent' ? `r:${o.q}` : o.item.editionId}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              aria-keyshortcuts={o.kind === 'recent' ? 'Delete' : undefined}
              className={`search-opt ${i === current ? 'active' : ''}`}
              // The focus stays in the box.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
            >
              {o.kind === 'recent' ? (
                <>
                  <Icon name="clock" size={16} />
                  <span className="grow">{o.q}</span>
                  <span
                    className="search-remove"
                    aria-hidden
                    title={t('search.removeRecent', { q: o.q })}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRecentSearch(o.q);
                    }}
                  >
                    <Icon name="x" size={14} />
                  </span>
                </>
              ) : (
                <>
                  <Cover
                    assetId={o.item.coverAssetId}
                    title={o.item.title}
                    authors={o.item.authors}
                    seed={o.item.editionId}
                    className="search-cover"
                    decorative
                  />
                  <span className="grow">
                    <b>{o.item.title}</b>
                    <span className="muted small search-sub">
                      {[o.item.authors.join(', '), o.item.publishedYear].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        {noResults && <p className="search-empty">{t('search.noResults')}</p>}
        {!typed && recents.length > 0 && (
          <button
            type="button"
            className="btn ghost sm search-clear-all"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              clearRecentSearches();
              input.current?.focus();
            }}
          >
            {t('search.clearRecent')}
          </button>
        )}
      </div>
      <span className="sr-only" role="status">
        {open ? status : ''}
      </span>
    </div>
  );
}
