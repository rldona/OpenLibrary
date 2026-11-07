import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatIsbn, normalizeIsbn, WISH_PRIORITIES, type WishDTO } from '@openlibrary/contracts/client';
import { api, coverUrl, errorText } from '../api';
import { CoverButton } from '../components/coverViewer';
import { CoverEditor } from '../components/coverEditor';
import { Banner, Cover, Icon } from '../components/ui';
import { DialogCancel, Modal, SidePanel } from '../components/dialog';
import { usePendingDeletes, useSnackbar } from '../components/snackbar';
import { BusyLabel, EmptyState, ErrorState, LoadingState } from '../components/states';
import { SelectMenu } from '../components/menu';
import { Segmented } from '../components/segmented';
import { useListView } from '../lib/listView';
import { arrangeWishes, WISH_SORTS, wishViewOf, type WishPriority } from '../lib/wishes';
import { useFieldError } from '../components/fields';
import { useQueryClient } from '@tanstack/react-query';
import { fmtDate, langName, splitList } from '../lib/format';
import { keys, lookupQuery, useInvalidate, useLookup, useWishlist } from '../lib/queries';
import { closeWish, openBook, openWish, setParams, useLocation } from '../lib/router';
import { useDocumentTitle } from '../lib/title';
import { useI18n } from '../i18n';

type Bought = (w: WishDTO) => void;

/**
 * Books you want (design §4, BR14): never part of the collection. "I bought it" opens the add-book form
 * pre-filled; when the book or copy is saved the wish becomes "acquired": it is kept as a record but no
 * longer shown here. A wish you no longer want is deleted for good.
 */
export function Wishlist({ onBought }: { onBought: Bought }) {
  const { t } = useI18n();
  const snackbar = useSnackbar();
  const pending = usePendingDeletes();
  const qc = useQueryClient();
  const list = useWishlist();
  const { params } = useLocation();
  const [editing, setEditing] = useState<WishDTO | 'new' | null>(null);
  const all = useMemo(() => (list.data?.items ?? []).filter((w) => w.status === 'open'), [list.data]);
  useProviderCovers(all);
  // Wishes deleted but still waiting for "Undo" are already out of the list.
  const open = all.filter((w) => !pending.has(`wish:${w.id}`));
  const filters = wishViewOf(params);
  const [layout, setLayout] = useListView('wishlist', 'table');
  const shown = arrangeWishes(open, filters);
  // After a deletion the focus was on a row (or in the panel) that is gone: the page heading takes it,
  // once the panel has closed and given the focus back.
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  useEffect(() => {
    if (focusHeading.current) {
      focusHeading.current = false;
      heading.current?.focus();
    }
  });

  /** Deferred behind "Undo": the wish leaves the list now and the server deletes it when the snackbar goes. */
  function remove(w: WishDTO) {
    // Replaced, not pushed: going back must not reopen the panel of a wish that is gone.
    if (params.get('wish') === w.id) setParams({ wish: undefined }, { replace: true });
    snackbar.deferDelete({
      key: `wish:${w.id}`,
      message: t('wish.deleted', { title: w.title }),
      commit: async ({ keepalive }) => {
        await api.deleteWish(w.id, { keepalive });
        // Waits for the fresh list, so the wish does not flash back when it stops being hidden.
        await Promise.all([
          qc.invalidateQueries({ queryKey: keys.wishlist }),
          qc.invalidateQueries({ queryKey: keys.stats }),
        ]);
      },
    });
    focusHeading.current = true;
  }

  return (
    <>
      <div className="vh">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {t('nav.wishlist')}
          </h1>
          <p className="sub">{t('wish.subtitle')}</p>
        </div>
        <div className="actions tight">
          <div className="seg" role="group" aria-label={t('library.view')}>
            <button
              className={layout === 'grid' ? 'on' : ''}
              aria-pressed={layout === 'grid'}
              onClick={() => setLayout('grid')}
            >
              <Icon name="grid" size={16} />
              {t('library.viewCovers')}
            </button>
            <button
              className={layout === 'table' ? 'on' : ''}
              aria-pressed={layout === 'table'}
              onClick={() => setLayout('table')}
            >
              <Icon name="list" size={16} />
              {t('library.viewTable')}
            </button>
          </div>
          <button className="btn" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> {t('wish.add')}
          </button>
        </div>
      </div>

      {list.isPending && <LoadingState />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {open.length > 0 && <WishFilters filters={filters} />}
      {list.isSuccess && !open.length && (
        <EmptyState icon="list" title={t('wish.emptyTitle')} text={t('wish.emptyText')} />
      )}
      {open.length > 0 && !shown.length && (
        <EmptyState
          icon="search"
          title={t('library.noMatchesTitle')}
          action={
            <button className="btn" onClick={() => setParams({ priority: undefined }, { replace: true })}>
              {t('library.clearFilters')}
            </button>
          }
        />
      )}
      {layout === 'table' ? (
        <ul className="list">
          {shown.map((w) => (
            <li key={w.id}>
              {/* One control per wish: the cover and the text open its panel together. */}
              <button className="wish-open" onClick={() => openWish(w.id)}>
                <Cover
                  assetId={w.coverAssetId}
                  title={w.title}
                  authors={w.authors}
                  className="wish-cover"
                  decorative
                />
                <span className="grow">
                  <b>{w.title}</b>{' '}
                  {w.priority !== 'normal' && (
                    <span className={`badge ${w.priority === 'high' ? 'accent' : ''}`}>
                      {t(`wish.priority.${w.priority}`)}
                    </span>
                  )}
                  <span className="small line">
                    {w.authors.length > 0 && <span className="authors">{w.authors.join(', ')}</span>}
                    {w.authors.length > 0 && w.isbn13 ? ' · ' : ''}
                    {w.isbn13 && <span className="muted">ISBN {formatIsbn(w.isbn13)}</span>}
                  </span>
                  {w.notes && <span className="note line">{w.notes}</span>}
                </span>
              </button>
              <div className="actions tight">
                <button className="btn sm primary" onClick={() => onBought(w)}>
                  {t('wish.bought')}
                </button>
                <button className="btn sm" onClick={() => setEditing(w)}>
                  {t('common.edit')}
                </button>
                <button className="btn sm ghost danger" onClick={() => void remove(w)}>
                  {t('wish.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid">
          {shown.map((w) => (
            <button key={w.id} className="card" onClick={() => openWish(w.id)}>
              <Cover assetId={w.coverAssetId} title={w.title} authors={w.authors} />
              <div>
                <div className="t">{w.title}</div>
                <div className="a authors">{w.authors.join(', ') || ' '}</div>
                <div className="x">
                  {w.priority !== 'normal' && (
                    <span className={`badge ${w.priority === 'high' ? 'accent' : ''}`}>
                      {t(`wish.priority.${w.priority}`)}
                    </span>
                  )}
                  {w.isbn13 && <span className="badge">ISBN {formatIsbn(w.isbn13)}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <WishDrawer
        items={open}
        loaded={list.isSuccess}
        error={list.isError ? list.error : null}
        onRetry={() => void list.refetch()}
        onBought={onBought}
        onEdit={setEditing}
        onDelete={remove}
      />
      {editing && <WishForm wish={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Wishes asked for once per page load: a failed or coverless lookup is not retried in a loop. */
const coverTried = new Set<string>();

/**
 * Wishes with an ISBN but no cover or authors (saved without a lookup, or before wishes had covers) get
 * what the providers know, stored on the server, so the list, the panel and the phone show it. Only
 * empty fields are filled: nothing the user typed is replaced.
 */
function useProviderCovers(items: WishDTO[]) {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  useEffect(() => {
    const todo = items.filter(
      (w) => w.isbn13 && (!w.coverAssetId || !w.authors.length) && !coverTried.has(w.id),
    );
    if (!todo.length) return;
    todo.forEach((w) => coverTried.add(w.id));
    void (async () => {
      let changed = false;
      for (const w of todo) {
        try {
          const r = await qc.fetchQuery(lookupQuery(w.isbn13!));
          const p = r.found ? r.proposal : null;
          if (!p) continue;
          const fields: { coverAssetId?: string; authors?: string[] } = {};
          if (!w.authors.length && p.authors.length) fields.authors = p.authors;
          if (!w.coverAssetId && p.coverUrl) {
            fields.coverAssetId = (await api.fetchCover(p.coverUrl).catch(() => null))?.id;
            if (!fields.coverAssetId) delete fields.coverAssetId;
          }
          if (!Object.keys(fields).length) continue;
          await api.patchWish(w.id, { baseVersion: w.version, fields });
          changed = true;
        } catch {
          // No connection, no cover or edited meanwhile: the wish simply stays without one.
        }
      }
      if (changed) invalidate();
    })();
  }, [items, qc, invalidate]);
}

/** Detail of a wish in the right-hand panel, like a book's (?wish=<id>). */
function WishDrawer({
  items,
  loaded,
  error,
  onRetry,
  onBought,
  onEdit,
  onDelete,
}: {
  items: WishDTO[];
  /** The wishlist has loaded: an id that is not in it (bought, deleted, mistyped) is dropped. */
  loaded: boolean;
  error: unknown;
  onRetry: () => void;
  onBought: Bought;
  onEdit: (w: WishDTO) => void;
  onDelete: (w: WishDTO) => void;
}) {
  const { t } = useI18n();
  const { params } = useLocation();
  const id = params.get('wish');
  const w = items.find((x) => x.id === id);
  // Open while the list loads too (a shared link), so the panel can show that it is loading.
  const open = !!w || (!!id && !loaded);
  const titleId = useId();
  useDocumentTitle(w?.title, 1);
  useEffect(() => {
    if (id && loaded && !w) setParams({ wish: undefined }, { replace: true });
  }, [id, loaded, w]);
  // What the providers know about the book: shown here, as in the form "I bought it" opens.
  const found = useLookup(w?.isbn13);
  const p = found.data?.found ? found.data.proposal : null;

  return (
    <SidePanel
      open={open}
      onClose={closeWish}
      label={t('wish.drawerLabel')}
      labelledBy={w ? titleId : undefined}
    >
      {!w && !error && open && <LoadingState />}
      {!w && !!error && (
        <div className="pad">
          <ErrorState error={error} onRetry={onRetry} />
        </div>
      )}
      {w && (
        <>
          <div className="dh">
            <CoverButton
              src={w.coverAssetId ? coverUrl(w.coverAssetId, 'full') : (p?.coverUrl ?? null)}
              title={w.title}
            >
              <Cover
                assetId={w.coverAssetId}
                src={w.coverAssetId ? null : p?.coverUrl}
                title={w.title}
                authors={w.authors}
                sizes="(max-width: 900px) 120px, 150px"
              />
            </CoverButton>
            <div className="grow">
              <div className="kicker">
                {t(`wish.status.${w.status}`)} · {t('wish.priority')}: {t(`wish.priority.${w.priority}`)}
              </div>
              <h2 id={titleId}>{w.title}</h2>
              <div className="authors">{w.authors.join(', ') || t('book.unknownAuthor')}</div>
              {w.isbn13 && <div className="muted mono small">ISBN {formatIsbn(w.isbn13)}</div>}
              <div className="actions">
                <button
                  className="btn sm primary"
                  onClick={() => {
                    closeWish();
                    onBought(w);
                  }}
                >
                  {t('wish.bought')}
                </button>
                <button className="btn sm" onClick={() => onEdit(w)}>
                  {t('common.edit')}
                </button>
                <button className="btn sm ghost danger" onClick={() => onDelete(w)}>
                  {t('wish.delete')}
                </button>
              </div>
            </div>
            <button className="icon-btn x" onClick={closeWish} aria-label={t('common.close')}>
              <Icon name="x" />
            </button>
          </div>
          {p && (
            <section className="sec">
              <h3>{t('wish.aboutBook')}</h3>
              <dl className="kv">
                {p.publisher && (
                  <div>
                    <dt>{t('book.publisher')}</dt>
                    <dd>{p.publisher}</dd>
                  </div>
                )}
                {p.publishedYear && (
                  <div>
                    <dt>{t('book.year')}</dt>
                    <dd>{p.publishedYear}</dd>
                  </div>
                )}
                {p.pages && (
                  <div>
                    <dt>{t('book.pages')}</dt>
                    <dd>{p.pages}</dd>
                  </div>
                )}
                {p.language && (
                  <div>
                    <dt>{t('book.language')}</dt>
                    <dd>{langName(p.language)}</dd>
                  </div>
                )}
              </dl>
              {p.subjects.length > 0 && (
                <div className="chips">
                  {p.subjects.map((x) => (
                    <span key={x} className="chip">
                      {x}
                    </span>
                  ))}
                </div>
              )}
              {p.description && <p className="note">{p.description}</p>}
              <p className="muted small">
                {t('form.foundTitle', { sources: found.data!.sources.join(', ') })}
              </p>
            </section>
          )}
          {w.notes && (
            <section className="sec">
              <h3>{t('wish.notes')}</h3>
              <p className="note">{w.notes}</p>
            </section>
          )}
          <section className="sec">
            <dl className="kv">
              <div>
                <dt>{t('wish.addedOn')}</dt>
                <dd>{fmtDate(w.createdAt)}</dd>
              </div>
              <div>
                <dt>{t('wish.updatedOn')}</dt>
                <dd>{fmtDate(w.updatedAt)}</dd>
              </div>
            </dl>
            {w.workId && (
              <p>
                <button
                  className="btn sm"
                  onClick={() => {
                    closeWish();
                    openBook(w.workId!);
                  }}
                >
                  {t('wish.openBook')}
                </button>
              </p>
            )}
          </section>
        </>
      )}
    </SidePanel>
  );
}

/** New wish or edit: title is required; an ISBN can be looked up to fill title and authors. */
function WishForm({ wish, onClose }: { wish: WishDTO | null; onClose: () => void }) {
  const { t } = useI18n();
  const invalidate = useInvalidate();
  const [title, setTitle] = useState(wish?.title ?? '');
  const [authors, setAuthors] = useState(wish?.authors.join('; ') ?? '');
  const [isbn, setIsbn] = useState(wish?.isbn13 ?? '');
  const [priority, setPriority] = useState<WishDTO['priority']>(wish?.priority ?? 'normal');
  const [notes, setNotes] = useState(wish?.notes ?? '');
  const [coverAssetId, setCoverAssetId] = useState<string | null>(wish?.coverAssetId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; isbn?: string }>({});
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(false);
  const [cropping, setCropping] = useState<File | null>(null);
  // Saving waits for the cover being uploaded.
  const [uploading, setUploading] = useState(false);
  const uploads = useRef(0);
  const titleError = useFieldError(fieldErrors.title);
  const isbnError = useFieldError(fieldErrors.isbn);
  const dirty =
    title !== (wish?.title ?? '') ||
    authors !== (wish?.authors.join('; ') ?? '') ||
    isbn !== (wish?.isbn13 ?? '') ||
    priority !== (wish?.priority ?? 'normal') ||
    notes !== (wish?.notes ?? '') ||
    coverAssetId !== (wish?.coverAssetId ?? null);
  /** The summary banner plus the message on the field itself, which takes the focus. */
  function invalid(field: 'title' | 'isbn', message: string) {
    setError(message);
    setFieldErrors({ [field]: message });
    document.getElementById(`${formId}-${field}`)?.focus();
  }

  async function lookup() {
    setError(null);
    setFieldErrors({});
    const n = normalizeIsbn(isbn);
    if (!n.ok) return invalid('isbn', t('form.isbnInvalid', { reason: t(`isbn.${n.reason}`) }));
    setIsbn(n.isbn13);
    setLooking(true);
    try {
      const p = (await api.lookup(n.isbn13)).proposal;
      if (p?.title && !title.trim()) setTitle(p.title);
      if (p?.authors.length && !authors.trim()) setAuthors(p.authors.join('; '));
      // The provider's cover is copied to the server now, so the wish (and later the book) can use it.
      if (p?.coverUrl && !coverAssetId) {
        const asset = await api.fetchCover(p.coverUrl).catch(() => null);
        if (asset) setCoverAssetId(asset.id);
      }
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setLooking(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    if (!title.trim()) return invalid('title', t('validation.titleRequired'));
    const fields = {
      title: title.trim(),
      authors: splitList(authors),
      isbn13: isbn.trim() || null,
      priority,
      notes: notes.trim(),
      coverAssetId,
    };
    setBusy(true);
    try {
      if (wish) {
        // Only what changed, so another device's edits to other fields are kept.
        const before: Record<string, unknown> = {
          title: wish.title,
          authors: wish.authors,
          isbn13: wish.isbn13,
          priority: wish.priority,
          notes: wish.notes,
          coverAssetId: wish.coverAssetId,
        };
        const changed = Object.fromEntries(
          Object.entries(fields).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])),
        );
        if (Object.keys(changed).length)
          await api.patchWish(wish.id, { baseVersion: wish.version, fields: changed });
      } else {
        await api.createWish(fields);
      }
      invalidate();
      onClose();
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t(wish ? 'wish.editTitle' : 'wish.add')}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <DialogCancel>{t('common.cancel')}</DialogCancel>
          <button className="btn primary" form="wish-form" disabled={busy || uploading}>
            <BusyLabel busy={busy || uploading} busyText={t('common.saving')}>
              {t('common.save')}
            </BusyLabel>
          </button>
        </>
      }
    >
      <form id="wish-form" onSubmit={submit} noValidate>
        <div className="isbnrow">
          <label>
            {t('form.isbnOptional')}
            <input
              id={`${formId}-isbn`}
              className="mono"
              value={isbn}
              onChange={(e) => setIsbn(e.target.value)}
              placeholder={t('form.isbnPlaceholder')}
              inputMode="numeric"
              {...isbnError.props}
            />
            {isbnError.message}
          </label>
          <button
            type="button"
            className="btn"
            disabled={!isbn.trim() || looking}
            onClick={() => void lookup()}
          >
            <BusyLabel busy={looking} busyText={t('form.searching')}>
              {t('form.lookup')}
            </BusyLabel>
          </button>
        </div>
        <div className="form-cover">
          <Cover assetId={coverAssetId} title={title || '?'} authors={splitList(authors)} />
          <div className="stack-sm">
            <b>{t('form.cover')}</b>
            <span className="muted small">{coverAssetId ? t('form.coverCurrent') : t('form.coverNone')}</span>
            <div className="row-sm">
              <label className="btn sm file">
                <Icon name="image" size={15} /> {t('form.chooseImage')}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    // Cropped first; the crop is what is uploaded.
                    if (f) setCropping(f);
                  }}
                />
              </label>
              {coverAssetId && (
                <button type="button" className="btn sm ghost" onClick={() => setCoverAssetId(null)}>
                  {t('common.remove')}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="fgrid">
          <label className="span2">
            {t('book.title')} *
            <input
              id={`${formId}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              {...titleError.props}
            />
            {titleError.message}
          </label>
          <label className="span2">
            {t('book.authors')}
            <input
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
              placeholder={t('form.separateWithSemicolon')}
            />
          </label>
          <div className="span2 field">
            <span className="field-label" id={`${formId}-priority`}>
              {t('wish.priority')}
            </span>
            <Segmented<WishPriority>
              label={t('wish.priority')}
              value={priority}
              onChange={setPriority}
              options={WISH_PRIORITIES.map((p) => ({ value: p, label: t(`wish.priority.${p}`) }))}
            />
          </div>
          <label className="span2">
            {t('wish.notes')}
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('wish.notesPlaceholder')}
            />
          </label>
        </div>
        {error && <Banner kind="err">{error}</Banner>}
      </form>
      {cropping && (
        <CoverEditor
          file={cropping}
          onCancel={() => setCropping(null)}
          onDone={(f) => {
            setCropping(null);
            setUploading(true);
            // Only the latest upload counts: an earlier one that answers late is ignored.
            const n = ++uploads.current;
            void api
              .uploadCover(f)
              .then((a) => n === uploads.current && setCoverAssetId(a.id))
              .catch((err) => n === uploads.current && setError(errorText(err, t)))
              .finally(() => n === uploads.current && setUploading(false));
          }}
        />
      )}
    </Modal>
  );
}

/** The order and the priority filter, as chips with a menu (the library's pattern). */
function WishFilters({ filters }: { filters: ReturnType<typeof wishViewOf> }) {
  const { t } = useI18n();
  const set = (patch: Record<string, string | undefined>) => setParams(patch, { replace: true });
  const priorityItems = [
    { value: '', label: t('wish.allPriorities') },
    ...WISH_PRIORITIES.map((p) => ({ value: p, label: t(`wish.priority.${p}`) })),
  ];
  return (
    <div className="filters" role="group" aria-label={t('library.filters')}>
      <SelectMenu
        name={t('wish.priority')}
        items={priorityItems}
        value={filters.priority ?? ''}
        active={!!filters.priority}
        onChange={(v) => set({ priority: v || undefined })}
      >
        {filters.priority
          ? t('library.filterValue', {
              name: t('wish.priority'),
              value: t(`wish.priority.${filters.priority}`),
            })
          : t('wish.priority')}
      </SelectMenu>
      <span className="grow" />
      <SelectMenu
        name={t('library.sort')}
        items={WISH_SORTS.map((k) => ({ value: k, label: t(`wish.sort.${k}`) }))}
        value={filters.sort}
        align="end"
        onChange={(v) => set({ sort: v === 'priority' ? undefined : v })}
      >
        <Icon name="sort" size={16} />
        {t('library.sortBy', { field: t(`wish.sort.${filters.sort}`) })}
      </SelectMenu>
    </div>
  );
}
