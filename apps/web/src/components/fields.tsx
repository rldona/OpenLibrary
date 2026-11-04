import { CONDITIONS, CONDITION_LABELS, type Condition } from '@openlibrary/contracts';
import { flattenLocations, useLocations } from '../lib/queries';
import { LANGUAGES, today } from '../lib/format';

export function LocationSelect({
  value,
  onChange,
  label = 'Ubicación',
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const locs = useLocations();
  const flat = flattenLocations(locs.data);
  return (
    <label className="span2">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Sin ubicación (colocar más tarde)</option>
        {flat.map((l) => (
          <option key={l.id} value={l.id}>
            {l.path.join(' › ')}
          </option>
        ))}
      </select>
      {!flat.length && locs.isSuccess && (
        <small className="muted">Aún no has creado ubicaciones: hazlo en «Ubicaciones».</small>
      )}
    </label>
  );
}

export function LanguageSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = value && !LANGUAGES[value] ? { [value]: value, ...LANGUAGES } : LANGUAGES;
  return (
    <label>
      Idioma
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {Object.entries(known).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
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

export const copyPayload = (c: CopyDraft) => ({
  locationId: c.locationId || null,
  condition: c.condition,
  acquiredOn: c.acquiredOn || null,
  priceCents: c.price.trim() ? Math.round(Number(c.price.replace(',', '.')) * 100) : null,
  notes: c.notes.trim(),
});

export function CopyFieldset({ value, onChange }: { value: CopyDraft; onChange: (c: CopyDraft) => void }) {
  const set = <K extends keyof CopyDraft>(k: K, v: CopyDraft[K]) => onChange({ ...value, [k]: v });
  const badPrice = value.price.trim() !== '' && !Number.isFinite(Number(value.price.replace(',', '.')));
  return (
    <fieldset>
      <legend>Tu ejemplar</legend>
      <div className="fgrid">
        <LocationSelect value={value.locationId} onChange={(v) => set('locationId', v)} />
        <label>
          Conservación
          <select value={value.condition} onChange={(e) => set('condition', e.target.value as Condition)}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fecha de adquisición
          <input type="date" value={value.acquiredOn} onChange={(e) => set('acquiredOn', e.target.value)} />
        </label>
        <label>
          Precio (€)
          <input
            inputMode="decimal"
            placeholder="Opcional"
            value={value.price}
            onChange={(e) => set('price', e.target.value)}
            aria-invalid={badPrice}
          />
          {badPrice && <small className="err">Escribe un número, p. ej. 12,95</small>}
        </label>
        <label className="span2">
          Notas personales
          <input
            placeholder="Dedicatoria, de dónde viene, estado…"
            value={value.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </div>
    </fieldset>
  );
}
