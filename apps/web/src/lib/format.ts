/** Locale-aware formatting. The locale is set by the i18n provider when the language changes. */
let locale = 'en-GB';
export const setFormatLocale = (l: string) => {
  locale = l;
};

/** Languages offered in book forms (ISO 639-1); names come from Intl in the UI language. */
export const BOOK_LANGUAGES = ['es', 'en', 'fr', 'it', 'pt', 'de', 'ca', 'gl', 'eu', 'la'];

export function langName(code: string | null | undefined): string {
  if (!code) return '—';
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) : code;
  } catch {
    return code;
  }
}

export const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00` : iso).toLocaleDateString(locale, { dateStyle: 'medium' })
    : '—';

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const fmtPrice = (cents: number | null | undefined, currency = 'EUR') =>
  cents == null ? '—' : (cents / 100).toLocaleString(locale, { style: 'currency', currency });

/** Price as typed in a form field, using the locale's decimal separator (12,95 / 12.95). */
export const priceInput = (cents: number | null | undefined) =>
  cents == null ? '' : (cents / 100).toLocaleString(locale, { useGrouping: false, maximumFractionDigits: 2 });

export const today = () => new Date().toISOString().slice(0, 10);

/** "Ana García; Luis Pérez" → ['Ana García', 'Luis Pérez'] */
export const splitList = (s: string) =>
  s
    .split(/[;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
