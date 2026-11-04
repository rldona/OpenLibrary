import { useState, type FormEvent } from 'react';
import { RETIRE_LABELS, RETIRE_REASONS, type CopyDTO } from '@openlibrary/contracts';
import { api, ApiError, errorText } from '../api';
import { Banner, Modal, useToast } from '../components/ui';
import { CopyFieldset, copyPayload, emptyCopy, type CopyDraft } from '../components/fields';
import { useInvalidate } from '../lib/queries';

export type CopyMode =
  | { kind: 'add'; editionId: string; title: string }
  | { kind: 'edit'; copy: CopyDTO }
  | { kind: 'retire'; copy: CopyDTO };

const fromCopy = (c: CopyDTO): CopyDraft => ({
  locationId: c.locationId ?? '',
  condition: c.condition,
  acquiredOn: c.acquiredOn ?? '',
  price: c.priceCents == null ? '' : String(c.priceCents / 100).replace('.', ','),
  notes: c.notes,
});

export function CopyForm({ mode, onClose }: { mode: CopyMode; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [draft, setDraft] = useState<CopyDraft>(mode.kind === 'add' ? emptyCopy() : fromCopy(mode.copy));
  const [reason, setReason] = useState<(typeof RETIRE_REASONS)[number]>('gifted');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode.kind === 'add') {
        const res = await api.createCopy({ editionId: mode.editionId, ...copyPayload(draft) });
        invalidate(res);
        const c = res.editions.flatMap((x) => x.copies).find((x) => x.id === res.created.copyId);
        toast(`Ejemplar ${c?.code} añadido a la misma edición`);
      } else if (mode.kind === 'edit') {
        const before = copyPayload(fromCopy(mode.copy));
        const after = copyPayload(draft);
        const fields = Object.fromEntries(
          Object.entries(after).filter(
            ([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof typeof before]),
          ),
        );
        if (Object.keys(fields).length) {
          invalidate(await api.patchCopy(mode.copy.id, { baseVersion: mode.copy.version, fields }));
          toast(`${mode.copy.code} actualizado`);
        }
      } else {
        invalidate(
          await api.patchCopy(mode.copy.id, {
            baseVersion: mode.copy.version,
            fields: { status: 'retired', retiredReason: reason },
          }),
        );
        toast(`${mode.copy.code} retirado (${RETIRE_LABELS[reason].toLowerCase()})`);
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? `${err.message} Cierra y vuelve a abrir la ficha.`
          : errorText(err),
      );
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode.kind === 'add'
      ? 'Nuevo ejemplar'
      : mode.kind === 'edit'
        ? `Ejemplar ${mode.copy.code}`
        : `Retirar ${mode.copy.code}`;
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" form="copy-form" disabled={busy}>
            {mode.kind === 'add' ? 'Añadir ejemplar' : mode.kind === 'edit' ? 'Guardar' : 'Retirar ejemplar'}
          </button>
        </>
      }
    >
      <form id="copy-form" onSubmit={submit}>
        {mode.kind === 'add' && (
          <Banner kind="info">
            Otro ejemplar de <b>{mode.title}</b>: comparte los datos bibliográficos de la edición, sin
            duplicarlos.
          </Banner>
        )}
        {mode.kind === 'retire' ? (
          <>
            <p className="muted">
              Deja de contar en tu colección, pero se conserva su historial. Útil si lo regalas, lo vendes o
              lo pierdes.
            </p>
            <label className="block">
              Motivo
              <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
                {RETIRE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {RETIRE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <CopyFieldset value={draft} onChange={setDraft} />
        )}
        {error && <Banner kind="err">{error}</Banner>}
      </form>
    </Modal>
  );
}
