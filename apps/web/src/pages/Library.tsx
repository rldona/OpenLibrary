import { useInfiniteQuery } from '@tanstack/react-query';
import { formatIsbn, type LibraryItem } from '@openlibrary/contracts/client';
import { api } from '../api';
import { Cover, Icon } from '../components/ui';
import { EmptyState, ErrorState, GridSkeleton, Spinner, useDelayed } from '../components/states';
import { fmtDate } from '../lib/format';
import { keys, shortPath, useLocations } from '../lib/queries';
import { openBook, setParams, useLocation } from '../lib/router';
import { clearFilters, isFiltered, LibraryFilters, libraryQueryOf } from './LibraryFilters';
import { useI18n } from '../i18n';

const PAGE = 60;

export function Library({ onAdd }: { onAdd: () => void }) {
  const { t } = useI18n();
  const { params } = useLocation();
  const q = libraryQueryOf(params);
  const view = params.get('view') === 'table' ? 'table' : 'grid';
  const locs = useLocations();

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
  const filtered = isFiltered(q);
  // New filters keep the previous results on screen (placeholder data) until the new ones arrive.
  const refiltering = lib.isFetching && lib.isPlaceholderData;
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
          <h1 tabIndex={-1}>{t('nav.library')}</h1>
          <p className="sub">
            {lib.isPending ? t('common.loading') : summary}
            {refiltering && <Refreshing />}
          </p>
        </div>
        <div className="seg" role="group" aria-label={t('library.view')}>
          <button
            className={view === 'grid' ? 'on' : ''}
            aria-pressed={view === 'grid'}
            onClick={() => setParams({ view: undefined }, { replace: true })}
          >
            <Icon name="grid" size={16} />
            {t('library.viewCovers')}
          </button>
          <button
            className={view === 'table' ? 'on' : ''}
            aria-pressed={view === 'table'}
            onClick={() => setParams({ view: 'table' }, { replace: true })}
          >
            <Icon name="list" size={16} />
            {t('library.viewTable')}
          </button>
        </div>
      </div>

      <LibraryFilters q={q} />

      {lib.isPending && <GridSkeleton />}
      {lib.isError && !items.length && (
        <ErrorState message={t('library.loadError')} error={lib.error} onRetry={() => void lib.refetch()} />
      )}
      {lib.isSuccess && !items.length && (
        <EmptyState
          icon={filtered ? 'search' : 'book'}
          title={t(filtered ? 'library.noMatchesTitle' : 'library.emptyTitle')}
          text={t(filtered ? 'library.noMatchesText' : 'library.emptyText')}
          action={
            filtered ? (
              <button className="btn" onClick={clearFilters}>
                {t('library.clearFilters')}
              </button>
            ) : (
              <button className="btn primary" onClick={onAdd}>
                <Icon name="plus" size={16} /> {t('book.add')}
              </button>
            )
          }
        />
      )}

      {view === 'grid' ? (
        <div className={`grid ${refiltering ? 'stale' : ''}`} aria-busy={refiltering}>
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
          <table className={`tbl ${refiltering ? 'stale' : ''}`} aria-busy={refiltering}>
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
                // The title is the row's control (a button: Enter and Space); clicking anywhere else on the
                // row does the same for the mouse.
                <tr key={it.editionId} onClick={() => openBook(it.workId, it.editionId)}>
                  <td className="mini">
                    <Cover
                      assetId={it.coverAssetId}
                      title={it.title}
                      authors={it.authors}
                      seed={it.editionId}
                      decorative
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="linklike"
                      onClick={(e) => {
                        e.stopPropagation();
                        openBook(it.workId, it.editionId);
                      }}
                    >
                      <b>{it.title}</b>
                    </button>
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

      {lib.isError && items.length > 0 && (
        <ErrorState
          compact
          message={t('library.loadError')}
          error={lib.error}
          onRetry={() => void lib.refetch()}
        />
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

/** A small, late indicator while new filters load: a quick answer shows nothing. */
function Refreshing() {
  const { t } = useI18n();
  const shown = useDelayed(300);
  return (
    <span className="refreshing" role="status">
      {shown && (
        <>
          <Spinner small />
          {t('library.updating')}
        </>
      )}
    </span>
  );
}
