import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { coverUrl } from '../api';
import { useI18n } from '../i18n';

// ---------- Icons (24×24 strokes) ----------
const PATHS: Record<string, string> = {
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  tree: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  pin: 'M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12zM12 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z',
  grid: 'M3 3h7v9H3zM14 3h7v9h-7zM3 15h7v6H3zM14 15h7v6h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  warn: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  check: 'M20 6 9 17l-5-5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  shelf: 'M3 20h18M5 20V8M9 20V5M13 20V9M17 20l2-12',
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  image:
    'M21 15l-5-5L5 21M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  chev: 'm9 18 6-6-6-6',
  chart: 'M3 3v18h18M8 17V11M13 17V7M18 17v-4',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};
export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

/** App icon: the rounded tile in the accent orange (the dark theme accent, as on the app's buttons) with an open book used by the favicon and the Android launcher. */
export function Logo({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#e2925f" />
      <path
        d="M7 9h6a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H7zM25 9h-6a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5H25z"
        fill="none"
        stroke="#1a120c"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------- Cover ----------
const PALETTES = [
  ['#7a2e2e', '#e8c07d', '#fdf6e9'],
  ['#1f3a5f', '#e9b44c', '#f4efe6'],
  ['#2f4f3a', '#d9a441', '#f3eee2'],
  ['#3b2a4f', '#f0a04b', '#f6f0ff'],
  ['#0f4c5c', '#e36414', '#fbf5ec'],
  ['#5c3d2e', '#c9a227', '#f7efe1'],
  ['#264653', '#e9c46a', '#f1faee'],
  ['#283618', '#dda15e', '#fefae0'],
  ['#3d405b', '#f2cc8f', '#f4f1de'],
  ['#6d2e46', '#d5b9b2', '#fbf0ec'],
  ['#14213d', '#fca311', '#e5e5e5'],
] as const;
const hash = (s: string) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h);
};

/**
 * The real cover if there is one; otherwise a cover generated from the title (no image never breaks the UI).
 * Provisional books get a dashed outline.
 */
export function Cover(props: {
  assetId?: string | null;
  src?: string | null;
  title: string;
  authors: string[];
  provisional?: boolean;
  seed?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  const src = props.src ?? (props.assetId ? coverUrl(props.assetId) : null);
  const author = props.authors.join(', ');
  if (src && !broken) {
    return (
      <div className={`cover img ${props.provisional ? 'prov' : ''} ${props.className ?? ''}`}>
        <img
          src={src}
          alt={t('cover.alt', { title: props.title })}
          loading="lazy"
          onError={() => setBroken(true)}
        />
      </div>
    );
  }
  const h = hash((props.seed ?? '') + props.title);
  const [bg, ac, ink] = PALETTES[h % PALETTES.length]!;
  const style = (h >> 4) % 4;
  return (
    <div
      className={`cover gen s${style} ${props.provisional ? 'prov' : ''} ${props.className ?? ''}`}
      style={{ '--bg': bg, '--ac': ac, '--ink': ink } as React.CSSProperties}
      role="img"
      aria-label={t('cover.generated', { title: props.title })}
    >
      <i className="deco" />
      <span className="ct">{props.title}</span>
      <span className="ca">{author}</span>
      {props.provisional && <span className="tag">{t('book.provisional')}</span>}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current
      ?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]),select,textarea')
      ?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Banner({ kind, children }: { kind: 'info' | 'warn' | 'ok' | 'err'; children: ReactNode }) {
  const icon = kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'warn';
  return (
    <div className={`banner ${kind}`} role={kind === 'err' ? 'alert' : undefined}>
      <Icon name={icon} />
      <div className="grow">{children}</div>
    </div>
  );
}

// ---------- Toasts ----------
const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className={`toast ${msg ? 'on' : ''}`} role="status">
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}
