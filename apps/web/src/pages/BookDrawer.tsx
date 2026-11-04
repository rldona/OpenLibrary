import { useEffect } from 'react';
import {
  CONDITION_LABELS,
  RETIRE_LABELS,
  formatIsbn,
  type EditionDTO,
  type WorkDTO,
  type CopyDTO,
} from '@openlibrary/contracts';
import { api, errorText } from '../api';
import { Banner, Cover, Icon, useToast } from '../components/ui';
import { fmtDate, fmtPrice, langName } from '../lib/format';
import { useInvalidate, useLocations, useWork, shortPath } from '../lib/queries';
import { closeBook, openBook, useLocation } from '../lib/router';

export type DrawerActions = {
  editBook: (work: WorkDTO, edition: EditionDTO) => void;
  newEdition: (work: WorkDTO) => void;
  addCopy: (editionId: string, title: string) => void;
  editCopy: (copy: CopyDTO) => void;
  retireCopy: (copy: CopyDTO) => void;
};

export function BookDrawer(actions: DrawerActions) {
  const { params } = useLocation();
  const workId = params.get('libro');
  const work = useWork(workId);
  const locs = useLocations();
  const toast = useToast();
  const invalidate = useInvalidate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && !document.querySelector('.modal-bg') && closeBook();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const open = !!workId;
  const data = work.data;
  const eds = data?.editions ?? [];
  const ed =
    eds.find((e) => e.id === params.get('ed')) ??
    eds.find((e) => e.copies.some((c) => c.status === 'active')) ??
    eds[0];
  const active = ed?.copies.filter((c) => c.status === 'active') ?? [];
  const retired = ed?.copies.filter((c) => c.status === 'retired') ?? [];
  const totalCopies = eds.reduce((n, e) => n + e.copies.filter((c) => c.status === 'active').length, 0);

  async function reactivate(c: CopyDTO) {
    try {
      invalidate(await api.patchCopy(c.id, { baseVersion: c.version, fields: { status: 'active' } }));
      toast(`${c.code} vuelve a tu colección`);
    } catch (e) {
      toast(errorText(e));
    }
  }

  async function removeEdition(e: EditionDTO) {
    if (
      !confirm(
        '¿Borrar esta edición y todos sus ejemplares? Úsalo solo para corregir errores de alta; si te has deshecho del libro, mejor «Retirar».',
      )
    )
      return;
    try {
      const r = await api.deleteEdition(e.id);
      invalidate();
      toast('Edición borrada');
      if (r.workDeleted) closeBook();
      else openBook(data!.work.id);
    } catch (err) {
      toast(errorText(err));
    }
  }

  return (
    <>
      <div className={`scrim ${open ? 'on' : ''}`} onClick={closeBook} />
      <aside className={`drawer ${open ? 'on' : ''}`} aria-label="Ficha del libro" aria-hidden={!open}>
        {open && work.isPending && <p className="muted pad">Cargando…</p>}
        {open && work.isError && (
          <div className="pad">
            <Banner kind="err">{errorText(work.error)}</Banner>
          </div>
        )}
        {data && ed && (
          <>
            <div className="dh">
              <Cover
                assetId={ed.coverAssetId}
                title={data.work.title}
                authors={data.work.authors}
                provisional={ed.metadataStatus === 'provisional'}
                seed={ed.id}
              />
              <div className="grow">
                <div className="kicker">
                  Obra · {eds.length} {eds.length === 1 ? 'edición' : 'ediciones'} · {totalCopies}{' '}
                  {totalCopies === 1 ? 'ejemplar' : 'ejemplares'}
                </div>
                <h2>{data.work.title}</h2>
                {data.work.subtitle && <div className="subt">{data.work.subtitle}</div>}
                <div>{data.work.authors.join(', ') || 'Autor desconocido'}</div>
                <div className="chips">
                  {data.work.subjects.map((s) => (
                    <span key={s} className="chip">
                      {s}
                    </span>
                  ))}
                  {data.work.series && <span className="chip">Serie: {data.work.series}</span>}
                </div>
                <div className="actions">
                  <button className="btn sm" onClick={() => actions.editBook(data.work, ed)}>
                    Editar ficha
                  </button>
                  <button className="btn sm" onClick={() => actions.addCopy(ed.id, data.work.title)}>
                    + Ejemplar
                  </button>
                  <button className="btn sm" onClick={() => actions.newEdition(data.work)}>
                    + Otra edición
                  </button>
                </div>
              </div>
              <button className="icon-btn x" onClick={closeBook} aria-label="Cerrar">
                <Icon name="x" />
              </button>
            </div>

            {ed.metadataStatus === 'provisional' && (
              <div className="pad-x">
                <Banner kind="warn">
                  <b>Registro provisional:</b> se dio de alta sin datos completos.{' '}
                  <button className="btn sm" onClick={() => actions.editBook(data.work, ed)}>
                    Completar
                  </button>
                </Banner>
              </div>
            )}

            <section className="sec">
              <h3>Edición</h3>
              {eds.length > 1 && (
                <div className="tabs">
                  {eds.map((x) => (
                    <button
                      key={x.id}
                      className={`tab ${x.id === ed.id ? 'on' : ''}`}
                      onClick={() => openBook(data.work.id, x.id)}
                    >
                      {x.publisher ?? 'Sin editorial'} {x.publishedYear ?? ''} · {langName(x.language)}
                    </button>
                  ))}
                </div>
              )}
              <dl className="kv">
                <div>
                  <dt>Editorial</dt>
                  <dd>{ed.publisher ?? '—'}</dd>
                </div>
                <div>
                  <dt>Año</dt>
                  <dd>{ed.publishedYear ?? '—'}</dd>
                </div>
                <div>
                  <dt>Idioma</dt>
                  <dd>{langName(ed.language)}</dd>
                </div>
                <div>
                  <dt>Páginas</dt>
                  <dd>{ed.pages ?? '—'}</dd>
                </div>
                <div>
                  <dt>Formato</dt>
                  <dd>{ed.format ?? '—'}</dd>
                </div>
                <div>
                  <dt>ISBN-13</dt>
                  <dd className="mono">{ed.isbn13 ? formatIsbn(ed.isbn13) : '—'}</dd>
                </div>
                <div>
                  <dt>ISBN-10</dt>
                  <dd className="mono">{ed.isbn10 ?? '—'}</dd>
                </div>
                <div>
                  <dt>Datos</dt>
                  <dd>{ed.metadataSource ?? 'Manual'}</dd>
                </div>
              </dl>
              {data.work.description && <p className="desc">{data.work.description}</p>}
            </section>

            <section className="sec">
              <h3>
                Ejemplares de esta edición <span className="badge">{active.length}</span>
              </h3>
              {active.map((c) => (
                <div key={c.id} className="copy">
                  <div className="copy-top">
                    <b className="mono">{c.code}</b>
                    <div className="actions tight">
                      <button className="btn sm" onClick={() => actions.editCopy(c)}>
                        Mover / editar
                      </button>
                      <button className="btn sm ghost danger" onClick={() => actions.retireCopy(c)}>
                        Retirar
                      </button>
                    </div>
                  </div>
                  <div className={`where ${c.locationId ? '' : 'none'}`}>
                    <Icon name="pin" size={20} />
                    <span>
                      {c.locationId ? shortPath(c.locationPath, locs.data) : 'Sin ubicación asignada'}
                    </span>
                  </div>
                  <div className="copy-meta">
                    <span>
                      Conservación <b>{CONDITION_LABELS[c.condition]}</b>
                    </span>
                    <span>
                      Adquirido <b>{fmtDate(c.acquiredOn)}</b>
                    </span>
                    <span>
                      Precio <b>{fmtPrice(c.priceCents, c.priceCurrency)}</b>
                    </span>
                  </div>
                  {c.notes && <div className="note">{c.notes}</div>}
                </div>
              ))}
              {!active.length && <p className="muted">No quedan ejemplares activos de esta edición.</p>}
              {retired.length > 0 && (
                <details className="retired">
                  <summary>Retirados ({retired.length})</summary>
                  {retired.map((c) => (
                    <div key={c.id} className="row-sm">
                      <span className="mono">{c.code}</span>
                      <span className="muted">
                        {RETIRE_LABELS[c.retiredReason as keyof typeof RETIRE_LABELS] ?? 'Retirado'} ·{' '}
                        {fmtDate(c.retiredOn)}
                      </span>
                      <button className="btn sm ghost" onClick={() => void reactivate(c)}>
                        Recuperar
                      </button>
                    </div>
                  ))}
                </details>
              )}
            </section>

            <section className="sec muted small">
              <button className="btn sm ghost danger" onClick={() => void removeEdition(ed)}>
                Borrar esta edición (corregir un alta errónea)
              </button>
            </section>
          </>
        )}
      </aside>
    </>
  );
}
