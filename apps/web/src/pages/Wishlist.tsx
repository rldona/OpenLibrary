import { useState, type FormEvent } from 'react';
import { formatIsbn, normalizeIsbn, WISH_PRIORITIES, type WishDTO } from '@openlibrary/contracts';
import { api, errorText } from '../api';
import { Banner, Icon, Modal, useToast } from '../components/ui';
import { fmtDate, splitList } from '../lib/format';
import { useInvalidate, useWishlist } from '../lib/queries';
import { useI18n } from '../i18n';

type Bought = (w: WishDTO) => void;

/**
 * Books you want (design §4, BR14): never part of the collection. "I bought it" opens the add-book form
 * pre-filled; when the book or copy is saved the wish becomes "acquired" and stays here as history.
 */
export function Wishlist({ onBought }: { onBought: Bought }) {
  const { t } = useI18n();
  const toast = useToast();
  const invalidate = useInvalidate();
  const list = useWishlist();
  const [editing, setEditing] = useState<WishDTO | 'new' | null>(null);
  const items = list.data?.items ?? [];
  const open = items.filter((w) => w.status === 'open');
  const done = items.filter((w) => w.status !== 'open');

  async function setStatus(w: WishDTO, status: 'open' | 'discarded') {
    try {
      await api.patchWish(w.id, { baseVersion: w.version, fields: { status } });
      invalidate();
    } catch (e) {
      toast(errorText(e, t));
      invalidate();
    }
  }

  return (
    <>
      <div className="vh">
        <div>
          <h1>{t('nav.wishlist')}</h1>
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
            <div className="grow">
              <b>{w.title}</b>{' '}
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
              <button className="btn sm ghost danger" onClick={() => void setStatus(w, 'discarded')}>
                {t('wish.discard')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {done.length > 0 && (
        <details className="retired">
          <summary>{t('wish.history', { n: done.length })}</summary>
          {done.map((w) => (
            <div key={w.id} className="row-sm">
              <span>{w.title}</span>
              <span className="muted">
                {t(`wish.status.${w.status}`)} · {fmtDate(w.updatedAt)}
              </span>
              {w.status === 'discarded' && (
                <button className="btn sm ghost" onClick={() => void setStatus(w, 'open')}>
                  {t('drawer.restore')}
                </button>
              )}
            </div>
          ))}
        </details>
      )}

      {editing && <WishForm wish={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
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
