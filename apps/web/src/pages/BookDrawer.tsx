import { useEffect } from 'react';
import { formatIsbn, type EditionDTO, type WorkDTO, type CopyDTO } from '@openlibrary/contracts';
import { api, errorText } from '../api';
import { Banner, Cover, Icon, useToast } from '../components/ui';
import { fmtDate, fmtPrice, langName } from '../lib/format';
import { useInvalidate, useLocations, useWork, shortPath } from '../lib/queries';
import { closeBook, openBook, useLocation } from '../lib/router';
import { useI18n } from '../i18n';

export type DrawerActions = {
  editBook: (work: WorkDTO, edition: EditionDTO) => void;
  newEdition: (work: WorkDTO) => void;
  addCopy: (editionId: string, title: string) => void;
  editCopy: (copy: CopyDTO) => void;
  retireCopy: (copy: CopyDTO) => void;
};

export function BookDrawer(actions: DrawerActions) {
  const { t } = useI18n();
  const { params } = useLocation();
  const workId = params.get('book');
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
      toast(t('drawer.restored', { code: c.code }));
    } catch (e) {
      toast(errorText(e, t));
    }
  }

  async function removeEdition(e: EditionDTO) {
    if (!confirm(t('drawer.deleteEditionConfirm'))) return;
    try {
      const r = await api.deleteEdition(e.id);
      invalidate();
      toast(t('drawer.editionDeleted'));
      if (r.workDeleted) closeBook();
      else openBook(data!.work.id);
    } catch (err) {
      toast(errorText(err, t));
    }
  }

  return (
    <>
      <div className={`scrim ${open ? 'on' : ''}`} onClick={closeBook} />
      <aside className={`drawer ${open ? 'on' : ''}`} aria-label={t('drawer.label')} aria-hidden={!open}>
        {open && work.isPending && <p className="muted pad">{t('common.loading')}</p>}
        {open && work.isError && (
          <div className="pad">
            <Banner kind="err">{errorText(work.error, t)}</Banner>
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
                  {t('drawer.kicker', {
                    editions: t(eds.length === 1 ? 'library.editions.one' : 'library.editions.other', {
                      n: eds.length,
                    }),
                    copies: t(totalCopies === 1 ? 'library.copies.one' : 'library.copies.other', {
                      n: totalCopies,
                    }),
                  })}
                </div>
                <h2>{data.work.title}</h2>
                {data.work.subtitle && <div className="subt">{data.work.subtitle}</div>}
                <div>{data.work.authors.join(', ') || t('book.unknownAuthor')}</div>
                <div className="chips">
                  {data.work.subjects.map((s) => (
                    <span key={s} className="chip">
                      {s}
                    </span>
                  ))}
                  {data.work.series && (
                    <span className="chip">{t('drawer.series', { series: data.work.series })}</span>
                  )}
                </div>
                <div className="actions">
                  <button className="btn sm" onClick={() => actions.editBook(data.work, ed)}>
                    {t('drawer.editBook')}
                  </button>
                  <button className="btn sm" onClick={() => actions.addCopy(ed.id, data.work.title)}>
                    {t('drawer.addCopy')}
                  </button>
                  <button className="btn sm" onClick={() => actions.newEdition(data.work)}>
                    {t('drawer.addEdition')}
                  </button>
                </div>
              </div>
              <button className="icon-btn x" onClick={closeBook} aria-label={t('common.close')}>
                <Icon name="x" />
              </button>
            </div>

            {ed.metadataStatus === 'provisional' && (
              <div className="pad-x">
                <Banner kind="warn">
                  <b>{t('drawer.provisionalTitle')}</b> {t('drawer.provisionalText')}{' '}
                  <button className="btn sm" onClick={() => actions.editBook(data.work, ed)}>
                    {t('drawer.complete')}
                  </button>
                </Banner>
              </div>
            )}

            <section className="sec">
              <h3>{t('drawer.edition')}</h3>
              {eds.length > 1 && (
                <div className="tabs">
                  {eds.map((x) => (
                    <button
                      key={x.id}
                      className={`tab ${x.id === ed.id ? 'on' : ''}`}
                      onClick={() => openBook(data.work.id, x.id)}
                    >
                      {x.publisher ?? t('book.noPublisher')} {x.publishedYear ?? ''} · {langName(x.language)}
                    </button>
                  ))}
                </div>
              )}
              <dl className="kv">
                <div>
                  <dt>{t('book.publisher')}</dt>
                  <dd>{ed.publisher ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('book.year')}</dt>
                  <dd>{ed.publishedYear ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('book.language')}</dt>
                  <dd>{langName(ed.language)}</dd>
                </div>
                <div>
                  <dt>{t('book.pages')}</dt>
                  <dd>{ed.pages ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('book.format')}</dt>
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
                  <dt>{t('drawer.dataSource')}</dt>
                  <dd>{ed.metadataSource ?? t('drawer.manual')}</dd>
                </div>
              </dl>
              {data.work.description && <p className="desc">{data.work.description}</p>}
            </section>

            <section className="sec">
              <h3>
                {t('drawer.copiesOfEdition')} <span className="badge">{active.length}</span>
              </h3>
              {active.map((c) => (
                <div key={c.id} className="copy">
                  <div className="copy-top">
                    <b className="mono">{c.code}</b>
                    <div className="actions tight">
                      <button className="btn sm" onClick={() => actions.editCopy(c)}>
                        {t('drawer.moveEdit')}
                      </button>
                      <button className="btn sm ghost danger" onClick={() => actions.retireCopy(c)}>
                        {t('drawer.retire')}
                      </button>
                    </div>
                  </div>
                  <div className={`where ${c.locationId ? '' : 'none'}`}>
                    <Icon name="pin" size={20} />
                    <span>
                      {c.locationId ? shortPath(c.locationPath, locs.data) : t('copy.noLocationAssigned')}
                    </span>
                  </div>
                  <div className="copy-meta">
                    <span>
                      {t('copy.condition')} <b>{t(`condition.${c.condition}`)}</b>
                    </span>
                    <span>
                      {t('copy.acquired')} <b>{fmtDate(c.acquiredOn)}</b>
                    </span>
                    <span>
                      {t('copy.price')} <b>{fmtPrice(c.priceCents, c.priceCurrency)}</b>
                    </span>
                  </div>
                  {c.notes && <div className="note">{c.notes}</div>}
                </div>
              ))}
              {!active.length && <p className="muted">{t('drawer.noActiveCopies')}</p>}
              {retired.length > 0 && (
                <details className="retired">
                  <summary>{t('drawer.retiredCount', { n: retired.length })}</summary>
                  {retired.map((c) => (
                    <div key={c.id} className="row-sm">
                      <span className="mono">{c.code}</span>
                      <span className="muted">
                        {t(`retire.${c.retiredReason ?? 'other'}`)} · {fmtDate(c.retiredOn)}
                      </span>
                      <button className="btn sm ghost" onClick={() => void reactivate(c)}>
                        {t('drawer.restore')}
                      </button>
                    </div>
                  ))}
                </details>
              )}
            </section>

            <section className="sec muted small">
              <button className="btn sm ghost danger" onClick={() => void removeEdition(ed)}>
                {t('drawer.deleteEdition')}
              </button>
            </section>
          </>
        )}
      </aside>
    </>
  );
}
