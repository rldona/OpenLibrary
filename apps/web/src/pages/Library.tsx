import { useInfiniteQuery } from '@tanstack/react-query';
import { formatIsbn, LIBRARY_SORTS, type LibraryItem, type LibraryQuery } from '@openlibrary/contracts';
import { api } from '../api';
import { Cover, Icon } from '../components/ui';
import { langName, fmtDate } from '../lib/format';
import { flattenLocations, keys, shortPath, useFacets, useLocations } from '../lib/queries';
import { openBook, setParams, useLocation } from '../lib/router';
import { useI18n } from '../i18n';

const PAGE = 60;

export function Library({ onAdd }: { onAdd: () => void }) {
  const { t } = useI18n();
  const { params } = useLocation();
  const q: LibraryQuery = {
    q: params.get('q') ?? undefined,
    location: (params.get('location') as LibraryQuery['location']) ?? undefined,
    subject: params.get('subject') ?? undefined,
    language: params.get('lang') ?? undefined,
    sort: (params.get('sort') as LibraryQuery['sort']) ?? 'title',
  };
  const view = params.get('view') === 'table' ? 'table' : 'grid';
  const locs = useLocations();
  const facets = useFacets();
  const flat = flattenLocations(locs.data);

  const lib = useInfiniteQuery({
    queryKey: [...keys.library, q],
    queryFn: ({ pageParam }) => api.library({ ...q, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: (prev) => prev,
  });
  const items = lib.data?.pages.flatMap((p) => p.items) ?? [];
  const total = lib.data?.pages[0]?.total ?? 0;
  const copies = items.reduce((n, i) => n + i.copies.length, 0);
  const filtered = !!(q.q || q.location || q.subject || q.language);
  const pathOf = (c: LibraryItem['copies'][number]) =>
    c.locationId ? shortPath(c.locationPath, locs.data) : t('copy.noLocation');

  const summary = [
    t(
      filtered
        ? total === 1
          ? 'library.editionsFound.one'
          : 'library.editionsFound.other'
        : total === 1
          ? 'library.editions.one'
          : 'library.editions.other',
      { n: total },
    ),
    items.length
      ? t(copies === 1 ? 'library.copies.one' : 'library.copies.other', {
          n: `${copies}${total > items.length ? '+' : ''}`,
        })
      : null,
    q.q ? t('library.searchFor', { q: q.q }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="vh">
        <div>
          <h1>{t('nav.library')}</h1>
          <p className="sub">{lib.isPending ? t('common.loading') : summary}</p>
        </div>
        <div className="seg" role="group" aria-label={t('library.view')}>
          <button
            className={view === 'grid' ? 'on' : ''}
            onClick={() => setParams({ view: undefined }, { replace: true })}
          >
            <Icon name="grid" size={16} />
            {t('library.viewCovers')}
          </button>
          <button
            className={view === 'table' ? 'on' : ''}
            onClick={() => setParams({ view: 'table' }, { replace: true })}
          >
            <Icon name="list" size={16} />
            {t('library.viewTable')}
          </button>
        </div>
      </div>

      <div className="filters">
        <select
          aria-label={t('copy.location')}
          value={q.location ?? ''}
          onChange={(e) => setParams({ location: e.target.value }, { replace: true })}
        >
          <option value="">{t('library.allLocations')}</option>
          <option value="none">— {t('copy.noLocation')} —</option>
          {flat.map((l) => (
            <option key={l.id} value={l.id}>
              {'  '.repeat(l.depth)}
              {l.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('book.subjects')}
          value={q.subject ?? ''}
          onChange={(e) => setParams({ subject: e.target.value }, { replace: true })}
        >
          <option value="">{t('library.allSubjects')}</option>
          {facets.data?.subjects.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.count})
            </option>
          ))}
        </select>
        <select
          aria-label={t('book.language')}
          value={q.language ?? ''}
          onChange={(e) => setParams({ lang: e.target.value }, { replace: true })}
        >
          <option value="">{t('library.allLanguages')}</option>
          {facets.data?.languages.map((l) => (
            <option key={l} value={l}>
              {langName(l)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('library.sort')}
          value={q.sort}
          onChange={(e) =>
            setParams({ sort: e.target.value === 'title' ? undefined : e.target.value }, { replace: true })
          }
        >
          {LIBRARY_SORTS.map((k) => (
            <option key={k} value={k}>
              {t('library.sortBy', { field: t(`library.sort.${k}`) })}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            className="btn ghost sm"
            onClick={() =>
              setParams({ q: undefined, location: undefined, subject: undefined, lang: undefined })
            }
          >
            {t('library.clearFilters')}
          </button>
        )}
      </div>

      {lib.isError && <div className="empty">{t('library.loadError')}</div>}
      {lib.isSuccess && !items.length && (
        <div className="empty">
          {filtered ? (
            <>
              <h3>{t('library.noMatchesTitle')}</h3>
              <p>{t('library.noMatchesText')}</p>
            </>
          ) : (
            <>
              <h3>{t('library.emptyTitle')}</h3>
              <p>{t('library.emptyText')}</p>
            </>
          )}
          <button className="btn primary" onClick={onAdd}>
            <Icon name="plus" size={16} /> {t('book.add')}
          </button>
        </div>
      )}

      {view === 'grid' ? (
        <div className="grid">
          {items.map((it) => (
            <button key={it.editionId} className="card" onClick={() => openBook(it.workId, it.editionId)}>
              <Cover
                assetId={it.coverAssetId}
                title={it.title}
                authors={it.authors}
                provisional={it.metadataStatus === 'provisional'}
                seed={it.editionId}
              />
              <div>
                <div className="t">{it.title}</div>
                <div className="a">{it.authors.join(', ') || ' '}</div>
                <div className="x">
                  {it.copies.length > 1 && <span className="badge">×{it.copies.length}</span>}
                  {it.editionCount > 1 && (
                    <span className="badge">{t('library.editions.other', { n: it.editionCount })}</span>
                  )}
                  {it.metadataStatus === 'provisional' && (
                    <span className="badge warn">{t('book.provisional')}</span>
                  )}
                </div>
                <div className="w">
                  <Icon name="pin" size={13} />
                  <span>{it.copies[0] ? pathOf(it.copies[0]) : ''}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        items.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th />
                <th>{t('book.title')}</th>
                <th>{t('book.publisher')}</th>
                <th>ISBN</th>
                <th title={t('library.copiesColumnTitle')}>{t('library.copiesColumn')}</th>
                <th>{t('copy.location')}</th>
                <th>{t('copy.acquired')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.editionId}
                  onClick={() => openBook(it.workId, it.editionId)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && openBook(it.workId, it.editionId)}
                >
                  <td className="mini">
                    <Cover
                      assetId={it.coverAssetId}
                      title={it.title}
                      authors={it.authors}
                      seed={it.editionId}
                    />
                  </td>
                  <td>
                    <b>{it.title}</b>
                    <div className="muted">{it.authors.join(', ')}</div>
                  </td>
                  <td>
                    {it.publisher ?? '—'}
                    {it.publishedYear ? ` · ${it.publishedYear}` : ''}
                  </td>
                  <td className="mono">
                    {it.isbn13 ? formatIsbn(it.isbn13) : <span className="muted">{t('book.noIsbn')}</span>}
                  </td>
                  <td>{it.copies.length}</td>
                  <td>
                    {[...new Set(it.copies.map(pathOf))].map((p) => (
                      <div key={p}>{p}</div>
                    ))}
                  </td>
                  <td className="muted">{fmtDate(it.lastAcquiredOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {lib.hasNextPage && (
        <div className="more">
          <button className="btn" disabled={lib.isFetchingNextPage} onClick={() => void lib.fetchNextPage()}>
            {lib.isFetchingNextPage
              ? t('common.loading')
              : t('library.loadMore', { n: total - items.length })}
          </button>
        </div>
      )}
    </>
  );
}
