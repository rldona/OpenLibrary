export const LANGUAGES: Record<string, string> = {
  es: 'Español',
  en: 'Inglés',
  fr: 'Francés',
  it: 'Italiano',
  pt: 'Portugués',
  de: 'Alemán',
  ca: 'Catalán',
  gl: 'Gallego',
  eu: 'Euskera',
  la: 'Latín',
};
export const langName = (code: string | null | undefined) => (code ? (LANGUAGES[code] ?? code) : '—');

export const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00` : iso).toLocaleDateString('es-ES', { dateStyle: 'medium' })
    : '—';

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const fmtPrice = (cents: number | null | undefined, currency = 'EUR') =>
  cents == null ? '—' : (cents / 100).toLocaleString('es-ES', { style: 'currency', currency });

export const today = () => new Date().toISOString().slice(0, 10);

/** «Ana García; Luis Pérez» → ['Ana García', 'Luis Pérez'] */
export const splitList = (s: string) =>
  s
    .split(/[;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
