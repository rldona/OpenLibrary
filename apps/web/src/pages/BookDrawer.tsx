import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { formatIsbn, type EditionDTO, type WorkDTO, type CopyDTO } from '@openlibrary/contracts/client';
import { api, coverUrl, errorText } from '../api';
import { CoverButton } from '../components/coverViewer';
import { Banner, Cover, Icon } from '../components/ui';
import { ConfirmDialog, SidePanel } from '../components/dialog';
import { useToast } from '../components/snackbar';
import { ErrorState, LoadingState } from '../components/states';
import { useDocumentTitle } from '../lib/title';
import { fmtDate, fmtPrice, langName } from '../lib/format';
import { useInvalidate, useLocations, useWork, shortPath } from '../lib/queries';
import { closeBook, openBook, setParams, useLocation } from '../lib/router';
import { useI18n } from '../i18n';
import { QuotesSection } from './QuotesSection';
import { ReadingSection } from './ReadingSection';

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
  const titleId = useId();
  const [deleting, setDeleting] = useState<EditionDTO | null>(null);

  const open = !!workId;
  const data = work.data;
  useDocumentTitle(open ? data?.work.title : null, 1);
  const eds = data?.editions ?? [];
  const ed =
    eds.find((e) => e.id === params.get('ed')) ??
    eds.find((e) => e.copies.some((c) => c.status === 'active')) ??
    eds[0];
  const active = ed?.copies.filter((c) => c.status === 'active') ?? [];
  const retired = ed?.copies.filter((c) => c.status === 'retired') ?? [];
  const totalCopies = eds.reduce((n, e) => n + e.copies.filter((c) => c.status === 'active').length, 0);

  async function toggleFavorite() {
    if (!data) return;
    try {
      invalidate(await api.setFavorite(data.work.id, !data.work.favorite));
    } catch (e) {
      toast(errorText(e, t), { kind: 'error' });
    }
  }

  async function reactivate(c: CopyDTO) {
    try {
      invalidate(await api.patchCopy(c.id, { baseVersion: c.version, fields: { status: 'active' } }));
      toast(t('drawer.restored', { code: c.code }));
    } catch (e) {
      toast(errorText(e, t), { kind: 'error' });
    }
  }

  /** Irreversible (the edition and its copies go for good): asked for with a destructive dialog. */
  async function removeEdition(e: EditionDTO) {
    setDeleting(null);
    try {
      const r = await api.deleteEdition(e.id);
      invalidate();
      toast(t('drawer.editionDeleted'));
      if (r.workDeleted) closeBook();
      else openBook(data!.work.id);
    } catch (err) {
      toast(errorText(err, t), { kind: 'error' });
    }
  }

  return (
    <SidePanel
      open={open}
      onClose={closeBook}
      label={t('drawer.label')}
      labelledBy={data && ed ? titleId : undefined}
    >
      {open && work.isPending && <LoadingState />}
      {open && work.isError && !data && (
        <div className="pad">
          <ErrorState error={work.error} onRetry={() => void work.refetch()} />
          <div className="center">
            <button className="btn ghost" onClick={closeBook}>
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
      {data && ed && (
        <>
          <div className="dh">
            <CoverButton
              src={ed.coverAssetId ? coverUrl(ed.coverAssetId, 'full') : null}
              title={data.work.title}
            >
              <Cover
                assetId={ed.coverAssetId}
                title={data.work.title}
                authors={data.work.authors}
                provisional={ed.metadataStatus === 'provisional'}
                seed={ed.id}
                sizes="(max-width: 900px) 120px, 150px"
              />
            </CoverButton>
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
              <h2 id={titleId}>{data.work.title}</h2>
              {data.work.subtitle && <div className="subt">{data.work.subtitle}</div>}
              <div className="authors">{data.work.authors.join(', ') || t('book.unknownAuthor')}</div>
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
                <button
                  className={`btn sm ${data.work.favorite ? 'primary' : ''}`}
                  aria-pressed={data.work.favorite}
                  onClick={() => void toggleFavorite()}
                >
                  <Icon name="heart" size={16} />{' '}
                  {t(data.work.favorite ? 'favorites.remove' : 'favorites.add')}
                </button>
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

          <ReadingSection key={data.work.id} data={data} preferredCopy={active[0]} />
          <QuotesSection key={`q-${data.work.id}`} data={data} />

          <section className="sec">
            <h3>{t('drawer.edition')}</h3>
            {eds.length > 1 && (
              <EditionTabs
                editions={eds}
                selected={ed.id}
                idPrefix={titleId}
                // Replaced, not pushed: switching editions does not fill the history.
                onSelect={(id) => setParams({ ed: id }, { replace: true })}
              />
            )}
            <div
              id={`${titleId}-edition`}
              role={eds.length > 1 ? 'tabpanel' : undefined}
              aria-labelledby={eds.length > 1 ? `${titleId}-tab-${ed.id}` : undefined}
            >
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
            </div>
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
            <button className="btn sm ghost danger" onClick={() => setDeleting(ed)}>
              {t('drawer.deleteEdition')}
            </button>
          </section>
        </>
      )}
      {deleting && (
        <ConfirmDialog
          title={t('drawer.deleteEditionTitle')}
          text={t('drawer.deleteEditionConfirm')}
          confirmLabel={t('common.delete')}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void removeEdition(deleting)}
        />
      )}
    </SidePanel>
  );
}

/**
 * The editions of a work as tabs (WAI-ARIA tabs pattern): one tab stop, arrows move between them and
 * select, Home and End jump to the ends.
 */
function EditionTabs({
  editions,
  selected,
  idPrefix,
  onSelect,
}: {
  editions: EditionDTO[];
  selected: string;
  /** Tabs are `<prefix>-tab-<edition>`; the panel they control is `<prefix>-edition`. */
  idPrefix: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const list = useRef<HTMLDivElement>(null);
  const panelId = `${idPrefix}-edition`;
  const tabId = (id: string) => `${idPrefix}-tab-${id}`;
  function onKeyDown(e: KeyboardEvent) {
    const i = editions.findIndex((x) => x.id === selected);
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (i + 1) % editions.length
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (i - 1 + editions.length) % editions.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? editions.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    const id = editions[next]!.id;
    onSelect(id);
    list.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus();
  }
  return (
    <div className="tabs" role="tablist" aria-label={t('drawer.edition')} ref={list} onKeyDown={onKeyDown}>
      {editions.map((x) => (
        <button
          key={x.id}
          id={tabId(x.id)}
          data-id={x.id}
          role="tab"
          aria-selected={x.id === selected}
          aria-controls={panelId}
          tabIndex={x.id === selected ? 0 : -1}
          className={`tab ${x.id === selected ? 'on' : ''}`}
          onClick={() => onSelect(x.id)}
        >
          {x.publisher ?? t('book.noPublisher')} {x.publishedYear ?? ''} · {langName(x.language)}
        </button>
      ))}
    </div>
  );
}
