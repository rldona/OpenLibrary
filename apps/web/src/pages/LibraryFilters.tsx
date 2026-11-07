/**
 * The library's filters as chips (Material 3 filter chips): reading status, "to complete", location,
 * subject and language, each a menu with one choice, and the order in a menu with a check. Below, the
 * filters in use as removable chips and "Clear filters". Everything lives in the URL.
 */
import {
  LIBRARY_SORTS,
  WORK_READING_STATUSES,
  type LibraryQuery,
  type WorkReadingStatus,
} from '@openlibrary/contracts/client';
import { SelectMenu, type MenuItem } from '../components/menu';
import { Icon } from '../components/ui';
import { langName } from '../lib/format';
import { flattenLocations, shortPath, useFacets, useLocations } from '../lib/queries';
import { setParams } from '../lib/router';
import { useI18n } from '../i18n';

/** The library's query from the URL (`lang` is `language`, `toComplete=1` is `provisional`). */
export function libraryQueryOf(params: URLSearchParams): LibraryQuery {
  const reading = params.get('reading');
  return {
    q: params.get('q') ?? undefined,
    location: (params.get('location') as LibraryQuery['location']) ?? undefined,
    subject: params.get('subject') ?? undefined,
    language: params.get('lang') ?? undefined,
    reading: (WORK_READING_STATUSES as readonly string[]).includes(reading ?? '')
      ? (reading as WorkReadingStatus)
      : undefined,
    provisional: params.get('toComplete') === '1' ? true : undefined,
    sort: (params.get('sort') as LibraryQuery['sort']) ?? 'title',
  };
}

export const isFiltered = (q: LibraryQuery) =>
  !!(q.q || q.location || q.subject || q.language || q.reading || q.provisional);

export const clearFilters = () =>
  setParams({
    q: undefined,
    location: undefined,
    subject: undefined,
    lang: undefined,
    reading: undefined,
    toComplete: undefined,
  });

const set = (patch: Record<string, string | undefined>) => setParams(patch, { replace: true });

export function LibraryFilters({ q }: { q: LibraryQuery }) {
  const { t } = useI18n();
  const locs = useLocations();
  const facets = useFacets();
  const flat = flattenLocations(locs.data);

  const readingItems: MenuItem[] = [
    { value: '', label: t('library.anyReading') },
    ...WORK_READING_STATUSES.map((s) => ({ value: s, label: t(`reading.status.${s}`) })),
  ];
  const locationItems: MenuItem[] = [
    { value: '', label: t('library.allLocations') },
    { value: 'none', label: t('copy.noLocation') },
    ...flat.map((l) => ({ value: l.id, label: l.name, depth: l.depth })),
  ];
  const subjectItems: MenuItem[] = [
    { value: '', label: t('library.allSubjects') },
    ...(facets.data?.subjects ?? []).map((s) => ({ value: s.name, label: `${s.name} (${s.count})` })),
  ];
  const languageItems: MenuItem[] = [
    { value: '', label: t('library.allLanguages') },
    ...(facets.data?.languages ?? []).map((l) => ({ value: l, label: langName(l) })),
  ];
  const sortItems: MenuItem[] = LIBRARY_SORTS.map((k) => ({ value: k, label: t(`library.sort.${k}`) }));

  const locationLabel = (id: string) =>
    id === 'none' ? t('copy.noLocation') : shortPath(flat.find((l) => l.id === id)?.path ?? [id], locs.data);

  // The filters in use, in the order of the chips; each one with what removes it.
  const inUse: { key: string; name: string; value: string; clear: Record<string, undefined> }[] = [
    q.q && { key: 'q', name: t('library.searchTerm'), value: `“${q.q}”`, clear: { q: undefined } },
    q.reading && {
      key: 'reading',
      name: t('reading.title'),
      value: t(`reading.status.${q.reading}`),
      clear: { reading: undefined },
    },
    q.provisional && {
      key: 'toComplete',
      name: t('library.toComplete'),
      value: '',
      clear: { toComplete: undefined },
    },
    q.location && {
      key: 'location',
      name: t('copy.location'),
      value: locationLabel(q.location),
      clear: { location: undefined },
    },
    q.subject && {
      key: 'subject',
      name: t('book.subjects'),
      value: q.subject,
      clear: { subject: undefined },
    },
    q.language && {
      key: 'lang',
      name: t('book.language'),
      value: langName(q.language),
      clear: { lang: undefined },
    },
  ].filter((x): x is Exclude<typeof x, '' | false | undefined> => !!x);
  const chipText = (name: string, value: string) =>
    value ? t('library.filterValue', { name, value }) : name;

  const menu = (
    name: string,
    param: string,
    items: MenuItem[],
    value: string | undefined,
    shown = value ? (items.find((i) => i.value === value)?.label ?? value) : '',
  ) => (
    <SelectMenu
      name={name}
      items={items}
      value={value ?? ''}
      active={!!value}
      onChange={(v) => set({ [param]: v || undefined })}
    >
      {chipText(name, shown)}
    </SelectMenu>
  );

  return (
    <>
      <div className="filters" role="group" aria-label={t('library.filters')}>
        {menu(t('reading.title'), 'reading', readingItems, q.reading)}
        <button
          type="button"
          className={`chip-btn ${q.provisional ? 'on' : ''}`}
          aria-pressed={!!q.provisional}
          onClick={() => set({ toComplete: q.provisional ? undefined : '1' })}
        >
          {q.provisional && <Icon name="check" size={16} />}
          {t('library.toComplete')}
        </button>
        {menu(
          t('copy.location'),
          'location',
          locationItems,
          q.location,
          q.location ? locationLabel(q.location) : '',
        )}
        {menu(t('book.subjects'), 'subject', subjectItems, q.subject, q.subject)}
        {menu(t('book.language'), 'lang', languageItems, q.language, q.language && langName(q.language))}
        <span className="grow" />
        <SelectMenu
          name={t('library.sort')}
          items={sortItems}
          value={q.sort ?? 'title'}
          align="end"
          onChange={(v) => set({ sort: v === 'title' ? undefined : v })}
        >
          <Icon name="sort" size={16} />
          {t('library.sortBy', { field: t(`library.sort.${q.sort ?? 'title'}`) })}
        </SelectMenu>
      </div>
      {inUse.length > 0 && (
        <div className="active-filters" role="group" aria-label={t('library.activeFilters')}>
          {inUse.map((f) => (
            <button
              key={f.key}
              type="button"
              className="input-chip"
              aria-label={t('library.removeFilter', { filter: chipText(f.name, f.value) })}
              onClick={() => set(f.clear)}
            >
              {chipText(f.name, f.value)}
              <Icon name="x" size={14} />
            </button>
          ))}
          <button type="button" className="btn ghost sm" onClick={clearFilters}>
            {t('library.clearFilters')}
          </button>
        </div>
      )}
    </>
  );
}
