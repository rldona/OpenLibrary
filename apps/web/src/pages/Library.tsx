import { useInfiniteQuery } from '@tanstack/react-query';
import { formatIsbn, type LibraryItem, type LibraryQuery } from '@openlibrary/contracts';
import { api } from '../api';
import { Cover, Icon } from '../components/ui';
import { langName, fmtDate } from '../lib/format';
import { flattenLocations, keys, shortPath, useFacets, useLocations } from '../lib/queries';
import { openBook, setParams, useLocation } from '../lib/router';

const PAGE = 60;
const SORTS: [NonNullable<LibraryQuery['sort']>, string][] = [
  ['title', 'Título'],
  ['author', 'Autor'],
  ['acquired', 'Adquirido (recientes)'],
  ['added', 'Añadido (recientes)'],
  ['location', 'Ubicación'],
];

export function Library({ onAdd }: { onAdd: () => void }) {
  const { params } = useLocation();
  const q: LibraryQuery = {
    q: params.get('q') ?? undefined,
    location: (params.get('ubicacion') as LibraryQuery['location']) ?? undefined,
    subject: params.get('genero') ?? undefined,
    language: params.get('idioma') ?? undefined,
    sort: (params.get('orden') as LibraryQuery['sort']) ?? 'title',
  };
  const view = params.get('vista') === 'tabla' ? 'table' : 'grid';
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
  const where = (it: LibraryItem) => {
    const c = it.copies[0];
    if (!c) return '';
    return c.locationId ? shortPath(c.locationPath, locs.data) : 'Sin ubicación';
  };

  return (
    <>
      <div className="vh">
        <div>
          <h1>Biblioteca</h1>
          <p className="sub">
            {lib.isPending
              ? 'Cargando…'
              : `${total} ${total === 1 ? 'edición' : 'ediciones'}${filtered ? (total === 1 ? ' encontrada' : ' encontradas') : ''}${items.length ? ` · ${copies}${total > items.length ? '+' : ''} ${copies === 1 ? 'ejemplar' : 'ejemplares'}` : ''}`}
            {q.q && <> · búsqueda «{q.q}»</>}
          </p>
        </div>
        <div className="seg" role="group" aria-label="Vista">
          <button
            className={view === 'grid' ? 'on' : ''}
            onClick={() => setParams({ vista: undefined }, { replace: true })}
          >
            <Icon name="grid" size={16} />
            Portadas
          </button>
          <button
            className={view === 'table' ? 'on' : ''}
            onClick={() => setParams({ vista: 'tabla' }, { replace: true })}
          >
            <Icon name="list" size={16} />
            Tabla
          </button>
        </div>
      </div>

      <div className="filters">
        <select
          aria-label="Ubicación"
          value={q.location ?? ''}
          onChange={(e) => setParams({ ubicacion: e.target.value }, { replace: true })}
        >
          <option value="">Todas las ubicaciones</option>
          <option value="none">— Sin ubicación —</option>
          {flat.map((l) => (
            <option key={l.id} value={l.id}>
              {'  '.repeat(l.depth)}
              {l.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Género"
          value={q.subject ?? ''}
          onChange={(e) => setParams({ genero: e.target.value }, { replace: true })}
        >
          <option value="">Todos los géneros</option>
          {facets.data?.subjects.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.count})
            </option>
          ))}
        </select>
        <select
          aria-label="Idioma"
          value={q.language ?? ''}
          onChange={(e) => setParams({ idioma: e.target.value }, { replace: true })}
        >
          <option value="">Todos los idiomas</option>
          {facets.data?.languages.map((l) => (
            <option key={l} value={l}>
              {langName(l)}
            </option>
          ))}
        </select>
        <select
          aria-label="Ordenar"
          value={q.sort}
          onChange={(e) =>
            setParams({ orden: e.target.value === 'title' ? undefined : e.target.value }, { replace: true })
          }
        >
          {SORTS.map(([k, l]) => (
            <option key={k} value={k}>
              Ordenar: {l}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            className="btn ghost sm"
            onClick={() =>
              setParams({ q: undefined, ubicacion: undefined, genero: undefined, idioma: undefined })
            }
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {lib.isError && <div className="empty">No se pudo cargar la biblioteca.</div>}
      {lib.isSuccess && !items.length && (
        <div className="empty">
          {filtered ? (
            <>
              <h3>Nada por aquí</h3>
              <p>No hay libros que coincidan. Prueba con otra búsqueda o quita filtros.</p>
            </>
          ) : (
            <>
              <h3>Tu biblioteca está vacía</h3>
              <p>
                Empieza creando tus ubicaciones (casa, habitaciones, estanterías) y añade tu primer libro.
              </p>
            </>
          )}
          <button className="btn primary" onClick={onAdd}>
            <Icon name="plus" size={16} /> Añadir libro
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
                  {it.editionCount > 1 && <span className="badge">{it.editionCount} ediciones</span>}
                  {it.metadataStatus === 'provisional' && <span className="badge warn">Provisional</span>}
                </div>
                <div className="w">
                  <Icon name="pin" size={13} />
                  <span>{where(it)}</span>
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
                <th>Título</th>
                <th>Editorial</th>
                <th>ISBN</th>
                <th>Ej.</th>
                <th>Ubicación</th>
                <th>Adquirido</th>
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
                    {it.isbn13 ? formatIsbn(it.isbn13) : <span className="muted">sin ISBN</span>}
                  </td>
                  <td>{it.copies.length}</td>
                  <td>
                    {[
                      ...new Set(
                        it.copies.map((c) =>
                          c.locationId ? shortPath(c.locationPath, locs.data) : 'Sin ubicación',
                        ),
                      ),
                    ].map((p) => (
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
            {lib.isFetchingNextPage ? 'Cargando…' : `Cargar más (${total - items.length} restantes)`}
          </button>
        </div>
      )}
    </>
  );
}
