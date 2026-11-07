import { useId, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LOCATION_KINDS, type LocationDTO, type LocationKind } from '@openlibrary/contracts/client';
import { api, errorText } from '../api';
import { Banner, Cover, Icon } from '../components/ui';
import { ConfirmDialog, DialogCancel, Modal } from '../components/dialog';
import { useToast } from '../components/snackbar';
import { BusyLabel, EmptyState, ErrorState, LoadingState } from '../components/states';
import { useFieldError } from '../components/fields';
import { flattenLocations, keys, useInvalidate, useLocations } from '../lib/queries';
import { navigate, openBook, setParams, useLocation } from '../lib/router';
import { useI18n } from '../i18n';

/** Ids of a location and all of its sub-locations. */
function subtreeOf(flat: { id: string; parentId: string | null }[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of flat) {
      if (l.parentId && out.has(l.parentId) && !out.has(l.id)) {
        out.add(l.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Suggested kind for a child, based on its parent. */
const NEXT_KIND: Record<LocationKind, LocationKind> = {
  home: 'room',
  room: 'bookcase',
  bookcase: 'shelf',
  shelf: 'other',
  box: 'other',
  other: 'other',
};

type Editing = { kind: 'create'; parent: LocationDTO | null } | { kind: 'edit'; loc: LocationDTO };

export function Locations() {
  const { t } = useI18n();
  const { params } = useLocation();
  const tree = useLocations();
  const flat = flattenLocations(tree.data);
  const byId = new Map(flat.map((l) => [l.id, l]));
  const sel = params.get('id') ?? flat[0]?.id ?? null;
  const loc = (sel && byId.get(sel)) || null;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deep, setDeep] = useState(true);
  const [deleting, setDeleting] = useState<LocationDTO | null>(null);
  const invalidate = useInvalidate();
  const toast = useToast();

  const children = (id: string | null) => flat.filter((l) => l.parentId === id);
  const ancestors = (l: LocationDTO) => {
    const out: LocationDTO[] = [];
    for (let cur: LocationDTO | undefined = l; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined)
      out.unshift(cur);
    return out;
  };
  const books = useQuery({
    queryKey: [...keys.library, 'loc', sel],
    queryFn: () => api.library({ location: sel ?? 'none', limit: 500, sort: 'location' }),
    enabled: sel !== null,
  });
  const subtree = useMemo(() => (sel ? subtreeOf(flat, sel) : new Set<string>()), [flat, sel]);
  // The listing returns editions with some copy here; only the copies that are actually here are shown.
  const rows = (books.data?.items ?? []).flatMap((it) =>
    it.copies
      .filter((c) => (deep ? !!c.locationId && subtree.has(c.locationId) : c.locationId === sel))
      .map((c) => ({ it, c })),
  );

  /**
   * Asked for with a destructive dialog rather than undone from the snackbar: the location shows in every
   * location picker and filter, and the server refuses it while it holds anything, so hiding it for a
   * while and deleting it later could fail out of sight.
   */
  async function remove(l: LocationDTO) {
    setDeleting(null);
    try {
      await api.deleteLocation(l.id);
      invalidate();
      setParams({ id: l.parentId ?? undefined });
      toast(t('locations.deleted'));
    } catch (e) {
      toast(errorText(e, t), { kind: 'error' });
    }
  }

  return (
    <>
      <div className="vh">
        <div>
          <h1 tabIndex={-1}>{t('nav.locations')}</h1>
          <p className="sub">{t('locations.subtitle')}</p>
        </div>
        <button className="btn" onClick={() => setEditing({ kind: 'create', parent: null })}>
          <Icon name="plus" size={16} /> {t('locations.newRoot')}
        </button>
      </div>

      {tree.isPending ? (
        <LoadingState />
      ) : tree.isError ? (
        <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />
      ) : !flat.length ? (
        <EmptyState
          icon="tree"
          title={t('locations.emptyTitle')}
          text={t('locations.emptyText')}
          action={
            <button className="btn primary" onClick={() => setEditing({ kind: 'create', parent: null })}>
              {t('locations.createFirst')}
            </button>
          }
        />
      ) : (
        <div>
          <div className="loc-bar">
            <label className="loc-go">
              <span>{t('locations.goTo')}</span>
              <select
                value={sel ?? ''}
                onChange={(e) => setParams({ id: e.target.value }, { replace: true })}
              >
                {flat.map((l) => (
                  <option key={l.id} value={l.id}>
                    {`${l.path.join(' › ')} (${l.copyCount})`}
                  </option>
                ))}
              </select>
            </label>
            {!!tree.data?.unassigned && (
              <button className="btn sm" onClick={() => navigate('/?location=none')}>
                <Icon name="warn" size={14} /> {t('copy.noLocation')} · {tree.data.unassigned}
              </button>
            )}
          </div>

          {loc && (
            <div>
              <div className="crumbs">
                {ancestors(loc).map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && ' › '}
                    <button onClick={() => setParams({ id: a.id }, { replace: true })}>{a.name}</button>
                  </span>
                ))}
              </div>
              <div className="vh tight">
                <h2>
                  {loc.name} <span className="muted small">{t(`locationKind.${loc.kind}`)}</span>
                </h2>
                <div className="actions tight">
                  <button className="btn sm" onClick={() => setEditing({ kind: 'create', parent: loc })}>
                    {t('locations.addChild')}
                  </button>
                  <button className="btn sm" onClick={() => setEditing({ kind: 'edit', loc })}>
                    {t('locations.editMove')}
                  </button>
                  <button className="btn sm ghost danger" onClick={() => setDeleting(loc)}>
                    {t('common.delete')}
                  </button>
                </div>
              </div>

              {children(loc.id).length > 0 && (
                <div className="subloc">
                  {children(loc.id).map((k) => (
                    <button key={k.id} onClick={() => setParams({ id: k.id }, { replace: true })}>
                      <b>{k.name}</b>
                      <span>
                        {t(k.copyCount === 1 ? 'library.copies.one' : 'library.copies.other', {
                          n: k.copyCount,
                        })}
                        {children(k.id).length
                          ? ` · ${t('locations.subdivisions', { n: children(k.id).length })}`
                          : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {children(loc.id).length > 0 && (
                <label className="ck">
                  <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />{' '}
                  {t('locations.includeChildren')}
                </label>
              )}

              {books.isPending && <LoadingState compact />}
              {books.isError && (
                <ErrorState compact error={books.error} onRetry={() => void books.refetch()} />
              )}
              {books.isSuccess && !rows.length && (
                <EmptyState compact icon="shelf" title={t('locations.noCopiesHere')} />
              )}
              {rows.map(({ it, c }) => (
                <button key={c.id} className="row" onClick={() => openBook(it.workId, it.editionId)}>
                  <Cover
                    assetId={it.coverAssetId}
                    title={it.title}
                    authors={it.authors}
                    seed={it.editionId}
                  />
                  <div className="grow">
                    <b>{it.title}</b> <span className="mono muted">{c.code}</span>
                    <div className="muted">
                      {it.authors.join(', ')}
                      {c.locationId !== sel && ` · ${c.locationPath.slice(loc.path.length).join(' › ')}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title={t('locations.deleteConfirm', { name: deleting.name })}
          text={t('locations.deleteText')}
          confirmLabel={t('common.delete')}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      )}
      {editing && (
        <LocationEditor
          editing={editing}
          all={flat}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            if (id) setParams({ id }, { replace: true });
          }}
        />
      )}
    </>
  );
}

function LocationEditor({
  editing,
  all,
  onClose,
  onSaved,
}: {
  editing: Editing;
  all: ReturnType<typeof flattenLocations>;
  onClose: () => void;
  onSaved: (id?: string) => void;
}) {
  const { t } = useI18n();
  const isEdit = editing.kind === 'edit';
  const base = isEdit ? editing.loc : null;
  const [name, setName] = useState(base?.name ?? '');
  const [kind, setKind] = useState<LocationKind>(
    base?.kind ??
      (editing.kind === 'create' ? (editing.parent ? NEXT_KIND[editing.parent.kind] : 'home') : 'other'),
  );
  const [parentId, setParentId] = useState<string>(
    isEdit ? (base!.parentId ?? '') : editing.kind === 'create' ? (editing.parent?.id ?? '') : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [nameInvalid, setNameInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameError = useFieldError(nameInvalid ? error : null);
  const nameId = useId();
  const invalidate = useInvalidate();
  const toast = useToast();
  const initialKind = useState(kind)[0];
  const initialParent = useState(parentId)[0];
  const dirty = name !== (base?.name ?? '') || kind !== initialKind || parentId !== initialParent;
  // When moving, the location itself and its descendants cannot be chosen as the parent.
  const forbidden = base ? subtreeOf(all, base.id) : new Set<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setNameInvalid(false);
    if (!name.trim()) {
      setError(t('validation.nameRequired'));
      setNameInvalid(true);
      document.getElementById(nameId)?.focus();
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        const fields: Record<string, unknown> = {};
        if (name.trim() !== base!.name) fields.name = name.trim();
        if (kind !== base!.kind) fields.kind = kind;
        if ((parentId || null) !== base!.parentId) fields.parentId = parentId || null;
        if (Object.keys(fields).length)
          await api.patchLocation(base!.id, { baseVersion: base!.version, fields });
        invalidate();
        toast(t('locations.updated'));
        onSaved(base!.id);
      } else {
        const before = new Set(all.map((l) => l.id));
        const tree = await api.createLocation({ parentId: parentId || null, name: name.trim(), kind });
        invalidate();
        toast(t('locations.created', { name: name.trim() }));
        onSaved(tree.items.find((l) => !before.has(l.id))?.id);
      }
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isEdit ? t('locations.editTitle', { name: base!.name }) : t('locations.newTitle')}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <DialogCancel>{t('common.cancel')}</DialogCancel>
          <button className="btn primary" form="loc-form" disabled={busy}>
            <BusyLabel busy={busy} busyText={t('common.saving')}>
              {t('common.save')}
            </BusyLabel>
          </button>
        </>
      }
    >
      <form id="loc-form" className="fgrid" onSubmit={submit} noValidate>
        <label className="span2">
          {t('locations.name')}
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('locations.namePlaceholder')}
            {...nameError.props}
          />
          {nameError.message}
        </label>
        <label>
          {t('locations.kind')}
          <select value={kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
            {LOCATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`locationKind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('locations.inside')}
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t('locations.noParent')}</option>
            {all
              .filter((l) => !forbidden.has(l.id))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.path.join(' › ')}
                </option>
              ))}
          </select>
        </label>
        {error && (
          <div className="span2">
            <Banner kind="err">{error}</Banner>
          </div>
        )}
      </form>
    </Modal>
  );
}
