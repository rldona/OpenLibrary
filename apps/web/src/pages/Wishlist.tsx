import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatIsbn, normalizeIsbn, WISH_PRIORITIES, type WishDTO } from '@openlibrary/contracts';
import { api, errorText } from '../api';
import { Banner, Cover, Icon, Modal, useToast } from '../components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { fmtDate, langName, splitList } from '../lib/format';
import { lookupQuery, useInvalidate, useLookup, useWishlist } from '../lib/queries';
import { closeWish, openBook, openWish, setParams, useLocation } from '../lib/router';
import { useI18n } from '../i18n';

type Bought = (w: WishDTO) => void;

/**
 * Books you want (design §4, BR14): never part of the collection. "I bought it" opens the add-book form
 * pre-filled; when the book or copy is saved the wish becomes "acquired": it is kept as a record but no
 * longer shown here. A wish you no longer want is deleted for good.
 */
export function Wishlist({ onBought }: { onBought: Bought }) {
  const { t } = useI18n();
  const toast = useToast();
  const invalidate = useInvalidate();
  const list = useWishlist();
  const { params } = useLocation();
  const [editing, setEditing] = useState<WishDTO | 'new' | null>(null);
  const open = useMemo(() => (list.data?.items ?? []).filter((w) => w.status === 'open'), [list.data]);
  useProviderCovers(open);
  // After a deletion the focus goes to the page heading once the wish has left the list.
  const heading = useRef<HTMLHeadingElement>(null);
  const deleted = useRef<string | null>(null);
  useEffect(() => {
    if (deleted.current && !open.some((w) => w.id === deleted.current)) {
      deleted.current = null;
      heading.current?.focus();
    }
  }, [open]);

  async function remove(w: WishDTO) {
    if (!confirm(t('wish.deleteConfirm', { title: w.title }))) return;
    try {
      await api.deleteWish(w.id);
      deleted.current = w.id;
      // Replaced, not pushed: going back must not reopen the panel of a wish that is gone.
      if (params.get('wish') === w.id) setParams({ wish: undefined }, { replace: true });
    } catch (e) {
      toast(errorText(e, t));
    }
    invalidate();
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
        <button className="btn" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> {t('wish.add')}
        </button>
      </div>

      {list.isSuccess && !open.length && (
        <div className="empty">
          <h3>{t('wish.emptyTitle')}</h3>
          <p>{t('wish.emptyText')}</p>
        </div>
      )}
      <ul className="list">
        {open.map((w) => (
          <li key={w.id}>
            <button className="wish-open" onClick={() => openWish(w.id)} aria-label={w.title}>
              <Cover assetId={w.coverAssetId} title={w.title} authors={w.authors} className="wish-cover" />
            </button>
            <div className="grow">
              <button className="linklike" onClick={() => openWish(w.id)}>
                <b>{w.title}</b>
              </button>{' '}
              {w.priority !== 'normal' && (
                <span className={`badge ${w.priority === 'high' ? 'accent' : ''}`}>
                  {t(`wish.priority.${w.priority}`)}
                </span>
              )}
              <div className="muted small">
                {[w.authors.join(', '), w.isbn13 && `ISBN ${formatIsbn(w.isbn13)}`]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {w.notes && <div className="note">{w.notes}</div>}
            </div>
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

      <WishDrawer
        items={open}
        loaded={list.isSuccess}
        onBought={onBought}
        onEdit={setEditing}
        onDelete={(w) => void remove(w)}
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
  onBought,
  onEdit,
  onDelete,
}: {
  items: WishDTO[];
  /** The wishlist has loaded: an id that is not in it (bought, deleted, mistyped) is dropped. */
  loaded: boolean;
  onBought: Bought;
  onEdit: (w: WishDTO) => void;
  onDelete: (w: WishDTO) => void;
}) {
  const { t } = useI18n();
  const { params } = useLocation();
  const id = params.get('wish');
  const w = items.find((x) => x.id === id);
  const open = !!w;
  useEffect(() => {
    if (id && loaded && !w) setParams({ wish: undefined }, { replace: true });
  }, [id, loaded, w]);
  // What the providers know about the book: shown here, as in the form "I bought it" opens.
  const found = useLookup(open ? w?.isbn13 : null);
  const p = found.data?.found ? found.data.proposal : null;

  // Same keyboard behaviour as the book panel: Escape closes, focus moves in and back.
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && !document.querySelector('.modal-bg') && closeWish();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement;
      panel.current?.focus();
    } else if (opener.current instanceof HTMLElement) {
      opener.current.focus();
      opener.current = null;
    }
  }, [open]);

  return (
    <>
      <div className={`scrim ${open ? 'on' : ''}`} onClick={closeWish} />
      <aside
        className={`drawer ${open ? 'on' : ''}`}
        aria-label={t('wish.drawerLabel')}
        aria-hidden={!open}
        inert={!open}
        ref={panel}
        tabIndex={-1}
      >
        {w && (
          <>
            <div className="dh">
              <Cover
                assetId={w.coverAssetId}
                src={w.coverAssetId ? null : p?.coverUrl}
                title={w.title}
                authors={w.authors}
              />
              <div className="grow">
                <div className="kicker">
                  {t(`wish.status.${w.status}`)} · {t('wish.priority')}: {t(`wish.priority.${w.priority}`)}
                </div>
                <h2>{w.title}</h2>
                <div>{w.authors.join(', ') || t('book.unknownAuthor')}</div>
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
      </aside>
    </>
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
  const [busy, setBusy] = useState(false);

  async function lookup() {
    setError(null);
    const n = normalizeIsbn(isbn);
    if (!n.ok) return setError(t('form.isbnInvalid', { reason: t(`isbn.${n.reason}`) }));
    setIsbn(n.isbn13);
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
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError(t('validation.titleRequired'));
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
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" form="wish-form" disabled={busy}>
            {t(busy ? 'common.saving' : 'common.save')}
          </button>
        </>
      }
    >
      <form id="wish-form" onSubmit={submit} noValidate>
        <div className="isbnrow">
          <label>
            {t('form.isbnOptional')}
            <input
              className="mono"
              value={isbn}
              onChange={(e) => setIsbn(e.target.value)}
              placeholder={t('form.isbnPlaceholder')}
              inputMode="numeric"
            />
          </label>
          <button type="button" className="btn" disabled={!isbn.trim()} onClick={() => void lookup()}>
            {t('form.lookup')}
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
                    if (f)
                      void api
                        .uploadCover(f)
                        .then((a) => setCoverAssetId(a.id))
                        .catch((err) => setError(errorText(err, t)));
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
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="span2">
            {t('book.authors')}
            <input
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
              placeholder={t('form.separateWithSemicolon')}
            />
          </label>
          <label>
            {t('wish.priority')}
            <select value={priority} onChange={(e) => setPriority(e.target.value as WishDTO['priority'])}>
              {WISH_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`wish.priority.${p}`)}
                </option>
              ))}
            </select>
          </label>
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
    </Modal>
  );
}
