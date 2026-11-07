import { useId } from 'react';
import { CONDITIONS, type Condition } from '@openlibrary/contracts/client';
import { flattenLocations, useLocations } from '../lib/queries';
import { BOOK_LANGUAGES, langName, today } from '../lib/format';
import { useI18n } from '../i18n';

/**
 * A field's own error message: the field points at it (aria-describedby) and is marked invalid. The text
 * sits inside the field's <label>, so it is hidden from the label's name and read once, as a description.
 * Forms keep their summary banner as well.
 */
export function useFieldError(error: string | null | undefined) {
  const id = useId();
  return {
    props: { 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? id : undefined },
    message: error ? (
      <small id={id} className="field-err" aria-hidden>
        {error}
      </small>
    ) : null,
  };
}

export function LocationSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const { t } = useI18n();
  const locs = useLocations();
  const flat = flattenLocations(locs.data);
  return (
    <label className="span2">
      {label ?? t('copy.location')}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('copy.noLocationLater')}</option>
        {flat.map((l) => (
          <option key={l.id} value={l.id}>
            {l.path.join(' › ')}
          </option>
        ))}
      </select>
      {!flat.length && locs.isSuccess && <small className="muted">{t('copy.noLocationsYet')}</small>}
    </label>
  );
}

export function LanguageSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const codes = value && !BOOK_LANGUAGES.includes(value) ? [value, ...BOOK_LANGUAGES] : BOOK_LANGUAGES;
  return (
    <label>
      {t('book.language')}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {codes.map((k) => (
          <option key={k} value={k}>
            {langName(k)}
          </option>
        ))}
      </select>
    </label>
  );
}

export type CopyDraft = {
  locationId: string;
  condition: Condition;
  acquiredOn: string;
  price: string;
  notes: string;
};
export const emptyCopy = (): CopyDraft => ({
  locationId: '',
  condition: 'good',
  acquiredOn: today(),
  price: '',
  notes: '',
});

/** Accepts both decimal separators: "12,95" and "12.95". */
const parsePrice = (s: string) => Number(s.trim().replace(',', '.'));

export const copyPayload = (c: CopyDraft) => ({
  locationId: c.locationId || null,
  condition: c.condition,
  acquiredOn: c.acquiredOn || null,
  priceCents: c.price.trim() ? Math.round(parsePrice(c.price) * 100) : null,
  notes: c.notes.trim(),
});

export function CopyFieldset({ value, onChange }: { value: CopyDraft; onChange: (c: CopyDraft) => void }) {
  const { t } = useI18n();
  const set = <K extends keyof CopyDraft>(k: K, v: CopyDraft[K]) => onChange({ ...value, [k]: v });
  const badPrice = value.price.trim() !== '' && !Number.isFinite(parsePrice(value.price));
  const priceError = useFieldError(badPrice ? t('copy.priceInvalid') : null);
  return (
    <fieldset>
      <legend>{t('copy.yourCopy')}</legend>
      <div className="fgrid">
        <LocationSelect value={value.locationId} onChange={(v) => set('locationId', v)} />
        <label>
          {t('copy.condition')}
          <select value={value.condition} onChange={(e) => set('condition', e.target.value as Condition)}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {t(`condition.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('copy.acquiredOn')}
          <input type="date" value={value.acquiredOn} onChange={(e) => set('acquiredOn', e.target.value)} />
        </label>
        <label>
          {t('copy.priceEur')}
          <input
            inputMode="decimal"
            placeholder={t('common.optional')}
            value={value.price}
            onChange={(e) => set('price', e.target.value)}
            {...priceError.props}
          />
          {priceError.message}
        </label>
        <label className="span2">
          {t('copy.notes')}
          <input
            placeholder={t('copy.notesPlaceholder')}
            value={value.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </div>
    </fieldset>
  );
}
