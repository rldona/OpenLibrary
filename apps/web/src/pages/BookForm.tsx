/**
 * Alta y edición de libros.
 *  - add:     ISBN opcional → propuesta de metadatos (revisable) → obra + edición + ejemplar.
 *  - edition: nueva edición de una obra existente.
 *  - edit:    corrige datos de la obra y de la edición (solo envía lo que has cambiado).
 */
import { useMemo, useState, type FormEvent } from 'react';
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
import { useInvalidate } from '../lib/queries';
import { openBook } from '../lib/router';

type Mode =
  | { kind: 'add'; prefill?: { isbn?: string } }
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

const fromModel = (w?: WorkDTO, e?: EditionDTO): Draft => ({
  isbn: e?.isbn13 ?? '',
  title: w?.title ?? '',
  subtitle: w?.subtitle ?? '',
  authors: w?.authors.join('; ') ?? '',
  subjects: w?.subjects.join('; ') ?? '',
  description: w?.description ?? '',
  series: w?.series ?? '',
  publisher: e?.publisher ?? '',
  publishedYear: e?.publishedYear ? String(e.publishedYear) : '',
  language: e?.language ?? (e ? '' : 'es'),
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
/** Solo los campos que el usuario ha cambiado: así no se pisan cambios hechos desde otro dispositivo. */
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
  onAddCopy: (editionId: string) => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const initial = useMemo(
    () =>
      mode.kind === 'edit'
        ? fromModel(mode.work, mode.edition)
        : mode.kind === 'edition'
          ? { ...fromModel(mode.work), isbn: '' }
          : { ...fromModel(), isbn: mode.prefill?.isbn ?? '' },
    [mode],
  );
  const [d, setD] = useState<Draft>(initial);
  const [copy, setCopy] = useState<CopyDraft>(emptyCopy);
  const [cover, setCover] = useState<CoverChoice>(
    mode.kind === 'edit' && mode.edition.coverAssetId
      ? { kind: 'asset', id: mode.edition.coverAssetId }
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

  async function doLookup() {
    setError(null);
    setDuplicate(null);
    const n = normalizeIsbn(d.isbn);
    if (!n.ok) return setLookup({ state: 'error', msg: n.reason });
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
      // La propuesta rellena; lo que el usuario ya hubiera escrito en la obra fija se respeta.
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
        // Si el proveedor no indica idioma, mejor vacío que suponer «Español».
        language: p.language ?? (mode.kind === 'add' && x.language === 'es' ? '' : x.language),
        pages: p.pages ? String(p.pages) : x.pages,
      }));
      if (p.coverUrl && cover.kind !== 'file') setCover({ kind: 'url', url: p.coverUrl });
      setSource(r.sources.join(' + '));
    } catch (e) {
      setLookup({ state: 'error', msg: errorText(e) });
    }
  }

  async function resolveCover(): Promise<string | null> {
    if (cover.kind === 'asset') return cover.id;
    if (cover.kind === 'file') return (await api.uploadCover(cover.file)).id;
    if (cover.kind === 'url') {
      try {
        return (await api.fetchCover(cover.url)).id;
      } catch {
        toast('No se pudo descargar la portada del proveedor; el libro se guarda sin ella.');
      }
    }
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!lockWork && !d.title.trim()) return setError('El título es obligatorio.');
    if (d.isbn.trim()) {
      const n = normalizeIsbn(d.isbn);
      if (!n.ok) return setError(`ISBN no válido: ${n.reason} Déjalo vacío si el libro no tiene ISBN.`);
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
        toast(result ? 'Ficha actualizada' : 'No había cambios');
        onClose();
        return;
      }
      const res = await api.createBook({
        ...(mode.kind === 'edition' ? { workId: mode.work.id } : { work: workFields(d) }),
        edition: { ...editionFields(d), coverAssetId, metadataSource: source ?? 'Manual' },
        copy: copyPayload(copy),
      });
      invalidate(res);
      const c = res.editions.flatMap((x) => x.copies).find((x) => x.id === res.created.copyId);
      toast(
        `Añadido «${res.work.title}» · ${c?.code ?? ''}${c?.locationPath.length ? ` en ${c.locationPath.join(' › ')}` : ' (sin ubicación)'}`,
      );
      onClose();
      openBook(res.work.id, res.created.editionId);
    } catch (err) {
      if (err instanceof ApiError && err.problem.type?.endsWith('duplicate-isbn')) {
        setDuplicate(err.problem.existing as { editionId: string; title: string; copies: number });
      } else if (err instanceof ApiError && err.status === 409) {
        setError(`${err.message} Cierra y vuelve a abrir la ficha para ver los datos actuales.`);
      } else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const coverSrc = cover.kind === 'file' ? cover.preview : cover.kind === 'url' ? cover.url : null;
  const r = lookup.state === 'done' ? lookup.r : null;
  const title =
    mode.kind === 'edit'
      ? 'Editar ficha'
      : mode.kind === 'edition'
        ? `Nueva edición de «${mode.work.title}»`
        : 'Añadir libro';

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="hint">
            Solo el título es obligatorio. Los datos externos son propuestas: corrige lo que quieras.
          </span>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" form="book-form" disabled={busy}>
            {busy ? 'Guardando…' : mode.kind === 'edit' ? 'Guardar cambios' : 'Añadir a la biblioteca'}
          </button>
        </>
      }
    >
      <form id="book-form" onSubmit={submit} noValidate>
        <div className="isbnrow">
          <label>
            ISBN (opcional)
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
              placeholder="978-84-… o ISBN-10"
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
            {lookup.state === 'busy' ? 'Buscando…' : 'Buscar datos'}
          </button>
        </div>

        {lookup.state === 'error' && <Banner kind="err">{lookup.msg}</Banner>}
        {duplicate && (
          <Banner kind="warn">
            <b>Ya tienes esta edición</b> («{duplicate.title}», {duplicate.copies}{' '}
            {duplicate.copies === 1 ? 'ejemplar' : 'ejemplares'}).{' '}
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                onClose();
                onAddCopy(duplicate.editionId);
              }}
            >
              Añadir otro ejemplar
            </button>
          </Banner>
        )}
        {r && !duplicate && r.found && (
          <Banner kind="ok">
            <b>Datos de {r.sources.join(' y ')}.</b> Son una propuesta: revísalos antes de guardar.
          </Banner>
        )}
        {r && !duplicate && !r.found && (
          <Banner kind="warn">
            {r.errors.length ? (
              <>
                <b>No se pudo consultar a los proveedores</b> (
                {r.errors.length === 2 ? '¿sin conexión a Internet?' : r.errors[0]}). Puedes rellenar la ficha
                a mano.
              </>
            ) : (
              <>
                <b>Sin resultados</b> para {formatIsbn(r.isbn13)}. Rellena lo que sepas; podrás completarlo
                más adelante.
              </>
            )}
          </Banner>
        )}

        <div className="form-cover">
          <Cover
            src={coverSrc}
            assetId={cover.kind === 'asset' ? cover.id : null}
            title={d.title || 'Sin título'}
            authors={splitList(d.authors)}
          />
          <div className="stack-sm">
            <b>Portada</b>
            <span className="muted small">
              {cover.kind === 'none'
                ? 'Sin portada: se mostrará una generada con el título.'
                : cover.kind === 'url'
                  ? 'Propuesta por el proveedor. Se guardará en tu servidor.'
                  : cover.kind === 'file'
                    ? 'Imagen elegida desde tu ordenador.'
                    : 'Portada actual.'}
            </span>
            <div className="row-sm">
              <label className="btn sm file">
                <Icon name="image" size={15} /> Elegir imagen…
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
                  Quitar
                </button>
              )}
            </div>
          </div>
        </div>

        {lockWork && (
          <Banner kind="info">
            Se añadirá como otra edición de la obra; los datos de la obra (título, autores, géneros) no se
            duplican.
          </Banner>
        )}
        <div className="fgrid">
          <label className="span2">
            Título *
            <input
              value={d.title}
              onChange={(e) => set('title', e.target.value)}
              disabled={lockWork}
              required
            />
          </label>
          <label className="span2">
            Subtítulo
            <input value={d.subtitle} onChange={(e) => set('subtitle', e.target.value)} disabled={lockWork} />
          </label>
          <label className="span2">
            Autor/es
            <input
              value={d.authors}
              onChange={(e) => set('authors', e.target.value)}
              placeholder="Separa varios con ;"
              disabled={lockWork}
            />
          </label>
          <label>
            Editorial
            <input value={d.publisher} onChange={(e) => set('publisher', e.target.value)} />
          </label>
          <label>
            Año de publicación
            <input
              inputMode="numeric"
              value={d.publishedYear}
              onChange={(e) => set('publishedYear', e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </label>
          <LanguageSelect value={d.language} onChange={(v) => set('language', v)} />
          <label>
            Páginas
            <input
              inputMode="numeric"
              value={d.pages}
              onChange={(e) => set('pages', e.target.value.replace(/\D/g, '').slice(0, 5))}
            />
          </label>
          <label>
            Formato
            <input
              value={d.format}
              onChange={(e) => set('format', e.target.value)}
              placeholder="Bolsillo, tapa dura…"
            />
          </label>
          <label>
            Serie / colección
            <input value={d.series} onChange={(e) => set('series', e.target.value)} disabled={lockWork} />
          </label>
          <label className="span2">
            Géneros
            <input
              value={d.subjects}
              onChange={(e) => set('subjects', e.target.value)}
              placeholder="Novela; Ciencia ficción"
              disabled={lockWork}
            />
          </label>
          <label className="span2">
            Sinopsis
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
