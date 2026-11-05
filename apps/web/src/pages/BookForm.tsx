/**
 * Adding and editing books.
 *  - add:     optional ISBN → metadata proposal (reviewable) → work + edition + copy.
 *  - edition: new edition of an existing work.
 *  - edit:    fixes work and edition data (only sends what you changed).
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  normalizeIsbn,
  formatIsbn,
  type EditionDTO,
  type LookupResult,
  type WorkDTO,
} from '@openlibrary/contracts';
import { api, ApiError, errorText } from '../api';
import { Banner, Cover, Icon, Modal, useToast } from '../components/ui';
import { CopyFieldset, LanguageSelect, copyPayload, emptyCopy, type CopyDraft } from '../components/fields';
import { splitList } from '../lib/format';
import { acquireWish, matchingWish, useInvalidate, useWishlist } from '../lib/queries';
import { openBook } from '../lib/router';
import { useI18n } from '../i18n';

type Mode =
  | {
      kind: 'add';
      prefill?: { isbn?: string; title?: string; authors?: string[]; wishId?: string; coverAssetId?: string };
    }
  | { kind: 'edition'; work: WorkDTO }
  | { kind: 'edit'; work: WorkDTO; edition: EditionDTO };

type Draft = {
  isbn: string;
  title: string;
  subtitle: string;
  authors: string;
  subjects: string;
  description: string;
  series: string;
  publisher: string;
  publishedYear: string;
  language: string;
  pages: string;
  format: string;
};

type CoverChoice =
  | { kind: 'none' }
  | { kind: 'asset'; id: string }
  | { kind: 'url'; url: string }
  | { kind: 'file'; file: File; preview: string };

const fromModel = (w?: WorkDTO, e?: EditionDTO, defaultLang = ''): Draft => ({
  isbn: e?.isbn13 ?? '',
  title: w?.title ?? '',
  subtitle: w?.subtitle ?? '',
  authors: w?.authors.join('; ') ?? '',
  subjects: w?.subjects.join('; ') ?? '',
  description: w?.description ?? '',
  series: w?.series ?? '',
  publisher: e?.publisher ?? '',
  publishedYear: e?.publishedYear ? String(e.publishedYear) : '',
  language: e ? (e.language ?? '') : defaultLang,
  pages: e?.pages ? String(e.pages) : '',
  format: e?.format ?? '',
});

const num = (s: string) => (s.trim() ? Number(s) : null);
const workFields = (d: Draft) => ({
  title: d.title.trim(),
  subtitle: d.subtitle.trim() || null,
  authors: splitList(d.authors),
  subjects: splitList(d.subjects),
  description: d.description.trim() || null,
  series: d.series.trim() || null,
});
const editionFields = (d: Draft) => ({
  publisher: d.publisher.trim() || null,
  publishedYear: num(d.publishedYear),
  language: d.language || null,
  pages: num(d.pages),
  format: d.format.trim() || null,
  isbn13: d.isbn.trim() || null,
});
/** Only the fields the user changed, so changes made from another device are never overwritten. */
function diff<T extends Record<string, unknown>>(before: T, after: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(after).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])),
  ) as Partial<T>;
}

export function BookForm({
  mode,
  onClose,
  onAddCopy,
}: {
  mode: Mode;
  onClose: () => void;
  onAddCopy: (editionId: string, wishId?: string) => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const invalidate = useInvalidate();
  const initial = useMemo(
    () =>
      mode.kind === 'edit'
        ? fromModel(mode.work, mode.edition)
        : mode.kind === 'edition'
          ? { ...fromModel(mode.work, undefined, lang), isbn: '' }
          : {
              ...fromModel(undefined, undefined, lang),
              isbn: mode.prefill?.isbn ?? '',
              title: mode.prefill?.title ?? '',
              authors: mode.prefill?.authors?.join('; ') ?? '',
            },
    // The form keeps its initial values even if the UI language changes while it is open.
    [mode],
  );
  const [d, setD] = useState<Draft>(initial);
  const [copy, setCopy] = useState<CopyDraft>(emptyCopy);
  const [cover, setCover] = useState<CoverChoice>(
    mode.kind === 'edit' && mode.edition.coverAssetId
      ? { kind: 'asset', id: mode.edition.coverAssetId }
      : mode.kind === 'add' && mode.prefill?.coverAssetId
        ? { kind: 'asset', id: mode.prefill.coverAssetId } // the wish's cover
        : { kind: 'none' },
  );
  const [lookup, setLookup] = useState<
    { state: 'idle' | 'busy' } | { state: 'done'; r: LookupResult } | { state: 'error'; msg: string }
  >({ state: 'idle' });
  const [source, setSource] = useState<string | null>(
    mode.kind === 'edit' ? mode.edition.metadataSource : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ editionId: string; title: string; copies: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft, v: string) => setD((x) => ({ ...x, [k]: v }));
  const lockWork = mode.kind === 'edition';
  const wishes = useWishlist();
  const wish =
    mode.kind === 'add' ? matchingWish(wishes.data?.items, mode.prefill?.wishId, d.isbn) : undefined;
  // "I bought it" with an ISBN: look it up once on opening (it may also be an edition you already own).
  useEffect(() => {
    if (mode.kind === 'add' && mode.prefill?.isbn) void doLookup();
  }, []);

  async function doLookup() {
    setError(null);
    setDuplicate(null);
    const n = normalizeIsbn(d.isbn);
    if (!n.ok) return setLookup({ state: 'error', msg: t(`isbn.${n.reason}`) });
    set('isbn', n.isbn13);
    setLookup({ state: 'busy' });
    try {
      const r = await api.lookup(n.isbn13);
      setLookup({ state: 'done', r });
      if (r.existing && !(mode.kind === 'edit' && r.existing.editionId === mode.edition.id)) {
        setDuplicate(r.existing);
        return;
      }
      const p = r.proposal;
      if (!p) return;
      // The proposal fills the form; the fixed work data of a new edition is left alone.
      setD((x) => ({
        ...x,
        ...(lockWork
          ? {}
          : {
              title: p.title ?? x.title,
              subtitle: p.subtitle ?? x.subtitle,
              authors: p.authors.length ? p.authors.join('; ') : x.authors,
              subjects: p.subjects.length ? p.subjects.join('; ') : x.subjects,
              description: p.description ?? x.description,
            }),
        publisher: p.publisher ?? x.publisher,
        publishedYear: p.publishedYear ? String(p.publishedYear) : x.publishedYear,
        // If the provider does not say, better empty than guessing the UI language.
        language: p.language ?? (mode.kind !== 'edit' && x.language === initial.language ? '' : x.language),
        pages: p.pages ? String(p.pages) : x.pages,
      }));
      // The provider's cover only fills an empty slot: a photo, the current cover or the wish's stay.
      if (p.coverUrl)
        setCover((c) => (c.kind === 'none' || c.kind === 'url' ? { kind: 'url', url: p.coverUrl! } : c));
      setSource(r.sources.join(' + '));
    } catch (e) {
      setLookup({ state: 'error', msg: errorText(e, t) });
    }
  }

  async function resolveCover(): Promise<string | null> {
    if (cover.kind === 'asset') return cover.id;
    if (cover.kind === 'file') return (await api.uploadCover(cover.file)).id;
    if (cover.kind === 'url') {
      try {
        return (await api.fetchCover(cover.url)).id;
      } catch {
        toast(t('form.coverDownloadFailed'));
      }
    }
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!lockWork && !d.title.trim()) return setError(t('validation.titleRequired'));
    if (d.isbn.trim()) {
      const n = normalizeIsbn(d.isbn);
      if (!n.ok) return setError(t('form.isbnInvalid', { reason: t(`isbn.${n.reason}`) }));
    }
    setBusy(true);
    try {
      const coverAssetId = await resolveCover();
      if (mode.kind === 'edit') {
        const wPatch = diff(workFields(initial), workFields(d));
        const ePatch: Record<string, unknown> = diff(editionFields(initial), editionFields(d));
        if (coverAssetId !== mode.edition.coverAssetId) ePatch.coverAssetId = coverAssetId;
        if (source && source !== mode.edition.metadataSource) ePatch.metadataSource = source;
        if (mode.edition.metadataStatus === 'provisional') ePatch.metadataStatus = 'complete';
        let result;
        if (Object.keys(wPatch).length)
          result = await api.patchWork(mode.work.id, { baseVersion: mode.work.version, fields: wPatch });
        if (Object.keys(ePatch).length)
          result = await api.patchEdition(mode.edition.id, {
            baseVersion: mode.edition.version,
            fields: ePatch,
          });
        invalidate(result);
        toast(t(result ? 'form.updated' : 'form.noChanges'));
        onClose();
        return;
      }
      const res = await api.createBook({
        ...(mode.kind === 'edition' ? { workId: mode.work.id } : { work: workFields(d) }),
        edition: { ...editionFields(d), coverAssetId, metadataSource: source ?? 'Manual' },
        copy: copyPayload(copy),
      });
      if (wish) await acquireWish(wish, res.created.copyId);
      invalidate(res);
      const c = res.editions.flatMap((x) => x.copies).find((x) => x.id === res.created.copyId);
      toast(
        c?.locationPath.length
          ? t('form.addedAt', { title: res.work.title, code: c.code, path: c.locationPath.join(' › ') })
          : t('form.addedNoLocation', { title: res.work.title, code: c?.code ?? '' }),
      );
      onClose();
      openBook(res.work.id, res.created.editionId);
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === 'duplicate-isbn') {
        setDuplicate(err.problem.existing as { editionId: string; title: string; copies: number });
      } else if (err instanceof ApiError && err.status === 409) {
        setError(`${err.message} ${t('form.reopenHint')}`);
      } else setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  const coverSrc = cover.kind === 'file' ? cover.preview : cover.kind === 'url' ? cover.url : null;
  const r = lookup.state === 'done' ? lookup.r : null;
  const title =
    mode.kind === 'edit'
      ? t('form.editTitle')
      : mode.kind === 'edition'
        ? t('form.newEditionTitle', { title: mode.work.title })
        : t('book.add');
  const coverHint = {
    none: t('form.coverNone'),
    url: t('form.coverProvider'),
    file: t('form.coverFile'),
    asset: t('form.coverCurrent'),
  }[cover.kind];

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="hint">{t('form.hint')}</span>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" form="book-form" disabled={busy}>
            {busy
              ? t('common.saving')
              : mode.kind === 'edit'
                ? t('common.saveChanges')
                : t('form.addToLibrary')}
          </button>
        </>
      }
    >
      <form id="book-form" onSubmit={submit} noValidate>
        <div className="isbnrow">
          <label>
            {t('form.isbnOptional')}
            <input
              className="mono"
              value={d.isbn}
              onChange={(e) => set('isbn', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void doLookup();
                }
              }}
              placeholder={t('form.isbnPlaceholder')}
              inputMode="numeric"
              autoFocus={mode.kind === 'add'}
            />
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => void doLookup()}
            disabled={!d.isbn.trim() || lookup.state === 'busy'}
          >
            <Icon name="search" size={16} />
            {lookup.state === 'busy' ? t('form.searching') : t('form.lookup')}
          </button>
        </div>

        {lookup.state === 'error' && <Banner kind="err">{lookup.msg}</Banner>}
        {duplicate && (
          <Banner kind="warn">
            <b>{t('form.duplicateTitle')}</b>{' '}
            {t(duplicate.copies === 1 ? 'form.duplicateText.one' : 'form.duplicateText.other', {
              title: duplicate.title,
              n: duplicate.copies,
            })}{' '}
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                onClose();
                onAddCopy(duplicate.editionId, wish?.id);
              }}
            >
              {t('form.addAnotherCopy')}
            </button>
          </Banner>
        )}
        {r && !duplicate && r.found && (
          <Banner kind="ok">
            <b>{t('form.foundTitle', { sources: r.sources.join(' + ') })}</b> {t('form.foundText')}
          </Banner>
        )}
        {r && !duplicate && !r.found && (
          <Banner kind="warn">
            {r.errors.length ? (
              <>
                <b>{t('form.providersFailedTitle')}</b> (
                {r.errors.length === 2 ? t('form.offlineGuess') : r.errors[0]}). {t('form.fillManually')}
              </>
            ) : (
              <>
                <b>{t('form.notFoundTitle')}</b> {t('form.notFoundText', { isbn: formatIsbn(r.isbn13) })}
              </>
            )}
          </Banner>
        )}

        <div className="form-cover">
          <Cover
            src={coverSrc}
            assetId={cover.kind === 'asset' ? cover.id : null}
            title={d.title || t('book.untitled')}
            authors={splitList(d.authors)}
          />
          <div className="stack-sm">
            <b>{t('form.cover')}</b>
            <span className="muted small">{coverHint}</span>
            <div className="row-sm">
              <label className="btn sm file">
                <Icon name="image" size={15} /> {t('form.chooseImage')}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setCover({ kind: 'file', file: f, preview: URL.createObjectURL(f) });
                  }}
                />
              </label>
              {cover.kind !== 'none' && (
                <button type="button" className="btn sm ghost" onClick={() => setCover({ kind: 'none' })}>
                  {t('common.remove')}
                </button>
              )}
            </div>
          </div>
        </div>

        {lockWork && <Banner kind="info">{t('form.newEditionInfo')}</Banner>}
        {wish && <Banner kind="info">{t('wish.willBeAcquired', { title: wish.title })}</Banner>}
        <div className="fgrid">
          <label className="span2">
            {t('book.title')} *
            <input
              value={d.title}
              onChange={(e) => set('title', e.target.value)}
              disabled={lockWork}
              required
            />
          </label>
          <label className="span2">
            {t('book.subtitle')}
            <input value={d.subtitle} onChange={(e) => set('subtitle', e.target.value)} disabled={lockWork} />
          </label>
          <label className="span2">
            {t('book.authors')}
            <input
              value={d.authors}
              onChange={(e) => set('authors', e.target.value)}
              placeholder={t('form.separateWithSemicolon')}
              disabled={lockWork}
            />
          </label>
          <label>
            {t('book.publisher')}
            <input value={d.publisher} onChange={(e) => set('publisher', e.target.value)} />
          </label>
          <label>
            {t('book.publishedYear')}
            <input
              inputMode="numeric"
              value={d.publishedYear}
              onChange={(e) => set('publishedYear', e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </label>
          <LanguageSelect value={d.language} onChange={(v) => set('language', v)} />
          <label>
            {t('book.pages')}
            <input
              inputMode="numeric"
              value={d.pages}
              onChange={(e) => set('pages', e.target.value.replace(/\D/g, '').slice(0, 5))}
            />
          </label>
          <label>
            {t('book.format')}
            <input
              value={d.format}
              onChange={(e) => set('format', e.target.value)}
              placeholder={t('form.formatPlaceholder')}
            />
          </label>
          <label>
            {t('book.series')}
            <input value={d.series} onChange={(e) => set('series', e.target.value)} disabled={lockWork} />
          </label>
          <label className="span2">
            {t('book.subjects')}
            <input
              value={d.subjects}
              onChange={(e) => set('subjects', e.target.value)}
              placeholder={t('form.subjectsPlaceholder')}
              disabled={lockWork}
            />
          </label>
          <label className="span2">
            {t('book.synopsis')}
            <textarea
              rows={3}
              value={d.description}
              onChange={(e) => set('description', e.target.value)}
              disabled={lockWork}
            />
          </label>
        </div>
        {mode.kind !== 'edit' && <CopyFieldset value={copy} onChange={setCopy} />}
        {error && <Banner kind="err">{error}</Banner>}
      </form>
    </Modal>
  );
}
