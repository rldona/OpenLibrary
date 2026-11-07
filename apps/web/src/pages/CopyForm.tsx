import { useState, type FormEvent } from 'react';
import { RETIRE_REASONS, type CopyDTO, type RetireReason } from '@openlibrary/contracts/client';
import { api, ApiError, errorText } from '../api';
import { Banner } from '../components/ui';
import { DialogCancel, Modal } from '../components/dialog';
import { BusyLabel } from '../components/states';
import { useToast } from '../components/snackbar';
import { CopyFieldset, copyPayload, emptyCopy, type CopyDraft } from '../components/fields';
import { priceInput } from '../lib/format';
import { acquireWish, matchingWish, useInvalidate, useWishlist } from '../lib/queries';
import { useI18n } from '../i18n';

export type CopyMode =
  /** `title` is omitted when coming from the duplicate-ISBN warning (the title is not loaded yet). */
  | { kind: 'add'; editionId: string; title?: string; wishId?: string }
  | { kind: 'edit'; copy: CopyDTO }
  | { kind: 'retire'; copy: CopyDTO };

const fromCopy = (c: CopyDTO): CopyDraft => ({
  locationId: c.locationId ?? '',
  condition: c.condition,
  acquiredOn: c.acquiredOn ?? '',
  price: priceInput(c.priceCents),
  notes: c.notes,
});

export function CopyForm({ mode, onClose }: { mode: CopyMode; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [initial] = useState<CopyDraft>(() => (mode.kind === 'add' ? emptyCopy() : fromCopy(mode.copy)));
  const [draft, setDraft] = useState<CopyDraft>(initial);
  const [reason, setReason] = useState<RetireReason>('gifted');
  const dirty =
    mode.kind === 'retire' ? reason !== 'gifted' : JSON.stringify(draft) !== JSON.stringify(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wishes = useWishlist();
  // "I bought it" for an edition you already own: the wish is fulfilled by this copy.
  const wish =
    mode.kind === 'add' && mode.wishId ? matchingWish(wishes.data?.items, mode.wishId, '') : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode.kind === 'add') {
        const res = await api.createCopy({ editionId: mode.editionId, ...copyPayload(draft) });
        if (wish) await acquireWish(wish, res.created.copyId);
        invalidate(res);
        const c = res.editions.flatMap((x) => x.copies).find((x) => x.id === res.created.copyId);
        toast(t('copyForm.added', { code: c?.code ?? '' }));
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
          toast(t('copyForm.updated', { code: mode.copy.code }));
        }
      } else {
        invalidate(
          await api.patchCopy(mode.copy.id, {
            baseVersion: mode.copy.version,
            fields: { status: 'retired', retiredReason: reason },
          }),
        );
        toast(t('copyForm.retired', { code: mode.copy.code, reason: t(`retire.${reason}`).toLowerCase() }));
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? `${err.message} ${t('form.reopenHint')}`
          : errorText(err, t),
      );
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode.kind === 'add'
      ? t('copyForm.newTitle')
      : mode.kind === 'edit'
        ? t('copyForm.editTitle', { code: mode.copy.code })
        : t('copyForm.retireTitle', { code: mode.copy.code });
  return (
    <Modal
      title={title}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <DialogCancel>{t('common.cancel')}</DialogCancel>
          <button className="btn primary" form="copy-form" disabled={busy}>
            <BusyLabel busy={busy} busyText={t('common.saving')}>
              {mode.kind === 'add'
                ? t('copyForm.addButton')
                : mode.kind === 'edit'
                  ? t('common.save')
                  : t('copyForm.retireButton')}
            </BusyLabel>
          </button>
        </>
      }
    >
      <form id="copy-form" onSubmit={submit}>
        {mode.kind === 'add' && (
          <Banner kind="info">
            {mode.title ? t('copyForm.addInfo', { title: mode.title }) : t('copyForm.addInfoGeneric')}
          </Banner>
        )}
        {mode.kind === 'retire' ? (
          <>
            <p className="muted">{t('copyForm.retireInfo')}</p>
            <label className="block">
              {t('copyForm.reason')}
              <select value={reason} onChange={(e) => setReason(e.target.value as RetireReason)}>
                {RETIRE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`retire.${r}`)}
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
