/**
 * Web i18n: English and Spanish.
 * - Initial language: the one saved by the user, otherwise the browser's (falls back to English).
 * - The API receives the same language via Accept-Language, so server errors match the UI.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { LANGS, pickLang, SHARED, translator, type Lang, type Params } from '@openlibrary/contracts';
import { setApiLang } from '../api';
import { setFormatLocale } from '../lib/format';
import { en } from './en';
import { es } from './es';

export const WEB = { en, es };
export type MessageKey = keyof typeof en;

const STORAGE_KEY = 'ol.lang';
export const LOCALES: Record<Lang, string> = { en: 'en-GB', es: 'es-ES' };
export const LANG_NAMES: Record<Lang, string> = { en: 'English', es: 'Español' };

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LANGS as readonly string[]).includes(saved)) return saved as Lang;
  } catch {
    // storage unavailable (private mode): use the browser language
  }
  return pickLang(navigator.languages?.join(',') || navigator.language);
}

function apply(lang: Lang) {
  setApiLang(lang);
  setFormatLocale(LOCALES[lang]);
  document.documentElement.lang = lang;
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translates a web key or a shared key (e.g. `condition.good`, `isbn.issn`). */
  t: (key: MessageKey | (string & {}), params?: Params) => string;
};
const I18nCtx = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const l = initialLang();
    apply(l);
    return l;
  });
  const setLang = useCallback((l: Lang) => {
    apply(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // not persisted; still applies for this visit
    }
    setLangState(l);
  }, []);
  const t = useMemo(() => translator([SHARED, WEB], lang), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

/** Compact language switcher (EN · ES). */
export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="seg lang-switch" role="group" aria-label={t('settings.language')}>
      {LANGS.map((l) => (
        <button
          key={l}
          className={l === lang ? 'on' : ''}
          aria-pressed={l === lang}
          onClick={() => setLang(l)}
          title={LANG_NAMES[l]}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
