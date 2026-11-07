import { useInfiniteQuery } from '@tanstack/react-query';
import { formatIsbn, type LibraryItem } from '@openlibrary/contracts/client';
import { api, errorText } from '../api';
import { Cover, Icon } from '../components/ui';
import { useToast } from '../components/snackbar';
import { EmptyState, ErrorState, GridSkeleton, Spinner, useDelayed } from '../components/states';
import { fmtDate } from '../lib/format';
import { keys, shortPath, useInvalidate, useLocations } from '../lib/queries';
import { useListView } from '../lib/listView';
import { navigate, openBook, useLocation } from '../lib/router';
import { clearFilters, isFiltered, LibraryFilters, libraryQueryOf } from './LibraryFilters';
import { useI18n } from '../i18n';

const PAGE = 60;

export function Library({ onAdd, favoritesOnly = false }: { onAdd: () => void; favoritesOnly?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { params } = useLocation();
  const q = { ...libraryQueryOf(params), ...(favoritesOnly ? { favorite: true } : {}) };
  // Biblioteca and Favoritos are separate pages: each keeps its own covers/table choice.
  const [view, setView] = useListView(favoritesOnly ? 'favorites' : 'library');
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
  const title = favoritesOnly ? t('nav.favorites') : t('nav.library');

  async function toggleFavorite(it: LibraryItem) {
    try {
      await api.setFavorite(it.workId, !it.favorite);
      invalidate();
    } catch (e) {
      toast(errorText(e, t), { kind: 'error' });
    }
  }

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
          <h1 tabIndex={-1}>{title}</h1>
          <p className="sub">
            {lib.isPending ? t('common.loading') : summary}
            {refiltering && <Refreshing />}
          </p>
        </div>
        <div className="seg" role="group" aria-label={t('library.view')}>
          <button
            className={view === 'grid' ? 'on' : ''}
            aria-pressed={view === 'grid'}
            onClick={() => setView('grid')}
          >
            <Icon name="grid" size={16} />
            {t('library.viewCovers')}
          </button>
          <button
            className={view === 'table' ? 'on' : ''}
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
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
          icon={filtered ? 'search' : favoritesOnly ? 'heart' : 'book'}
          title={t(
            filtered
              ? 'library.noMatchesTitle'
              : favoritesOnly
                ? 'favorites.emptyTitle'
                : 'library.emptyTitle',
          )}
          text={t(
            filtered ? 'library.noMatchesText' : favoritesOnly ? 'favorites.emptyText' : 'library.emptyText',
          )}
          action={
            filtered ? (
              <button className="btn" onClick={clearFilters}>
                {t('library.clearFilters')}
              </button>
            ) : favoritesOnly ? (
              <button className="btn" onClick={() => navigate('/')}>
                {t('nav.library')}
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
            <div key={it.editionId} className="card">
              <div className="cover-wrap">
                <button
                  type="button"
                  className="cover-open"
                  onClick={() => openBook(it.workId, it.editionId)}
                  aria-label={it.title}
                >
                  <Cover
                    assetId={it.coverAssetId}
                    title={it.title}
                    authors={it.authors}
                    provisional={it.metadataStatus === 'provisional'}
                    seed={it.editionId}
                  />
                </button>
                {it.rating != null && (
                  <span className="rating-flap" title={t('reading.rating')}>
                    ★ {it.rating}
                  </span>
                )}
                <button
                  type="button"
                  className={`favorite ${it.favorite ? 'on' : ''}`}
                  aria-pressed={it.favorite}
                  aria-label={t(it.favorite ? 'favorites.remove' : 'favorites.add')}
                  onClick={() => void toggleFavorite(it)}
                >
                  <Icon name="heart" size={16} />
                </button>
              </div>
              <button type="button" className="card-text" onClick={() => openBook(it.workId, it.editionId)}>
                <div className="t">{it.title}</div>
                <div className="a">{it.authors.join(', ') || ' '}</div>
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
              </button>
            </div>
          ))}
        </div>
      ) : (
        items.length > 0 && (
          <table className={`tbl ${refiltering ? 'stale' : ''}`} aria-busy={refiltering}>
            <thead>
              <tr>
                <th />
                <th>{t('book.title')}</th>
                <th>{t('reading.rating')}</th>
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
                    <div className="title-line">
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
                      <button
                        type="button"
                        className={`favorite inline ${it.favorite ? 'on' : ''}`}
                        aria-pressed={it.favorite}
                        aria-label={t(it.favorite ? 'favorites.remove' : 'favorites.add')}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleFavorite(it);
                        }}
                      >
                        <Icon name="heart" size={15} />
                      </button>
                    </div>
                    <div className="authors">{it.authors.join(', ')}</div>
                  </td>
                  <td className="rating-cell">{it.rating != null ? `★ ${it.rating}` : '—'}</td>
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
