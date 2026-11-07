/**
 * Snackbars (Material 3): one message at a time, queued, on the inverse surface, with an optional action
 * and a close button. Also the deferred deletes behind "Undo".
 *
 * Deferred delete: the item leaves the screen at once (`usePendingDeletes`) but the server call waits for
 * the snackbar to go: when it times out, is closed or is replaced by another message. "Undo" cancels it
 * and nothing reaches the server. If the page is left meanwhile (`pagehide`, or the tab hidden, which is
 * the last event a phone reliably gets) or the provider unmounts, the pending calls run straight away
 * with `keepalive`, so the browser completes them even as the page goes, and their "Undo" snackbars are
 * withdrawn: there is nothing left to undo. Each call runs once.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { errorText } from '../api';
import { useI18n } from '../i18n';
import { useTopModal } from './dialog';
import { Icon } from './ui';

export const SNACK_DURATION = 4000;
/** Long enough to read the message and reach "Undo". */
export const SNACK_ACTION_DURATION = 8000;
/** How long signing out waits for pending deletions before it goes ahead anyway. */
export const SIGN_OUT_FLUSH_MS = 5000;

type DismissReason = 'timeout' | 'action' | 'close' | 'replaced' | 'flush';
export type SnackOptions = {
  kind?: 'info' | 'error';
  action?: { label: string; onAction: () => void };
  duration?: number;
  onDismiss?: (reason: DismissReason) => void;
};
type Snack = SnackOptions & { id: number; message: string };

export type DeferredDelete = {
  /** Identifies the item while it is hidden, e.g. `wish:<id>`. */
  key: string;
  message: string;
  /** The real deletion (and the refresh of what shows it). `keepalive` when the page is going away. */
  commit: (opts: { keepalive: boolean }) => Promise<unknown>;
  onUndo?: () => void;
};

export type FlushOptions = {
  keepalive?: boolean;
  /** Gives up waiting after this long (the calls still run): signing out must not hang. */
  timeoutMs?: number;
};
type Ctx = {
  /** Returns the message's id. */
  show: (message: string, opts?: SnackOptions) => number;
  deferDelete: (d: DeferredDelete) => void;
  /** Runs every pending delete now (before signing out, for instance) and withdraws its "Undo". */
  flush: (opts?: FlushOptions) => Promise<void>;
  pending: ReadonlySet<string>;
};
const SnackCtx = createContext<Ctx>({
  show: () => 0,
  deferDelete: () => undefined,
  flush: async () => undefined,
  pending: new Set(),
});

/** Shows a message: `toast(text)` or `toast(text, { kind: 'error' })`. */
export const useToast = () => useContext(SnackCtx).show;
export const useSnackbar = () => useContext(SnackCtx);
/** Keys of the items deleted but not yet committed: hide them. */
export const usePendingDeletes = () => useContext(SnackCtx).pending;

type Pending = {
  state: 'waiting' | 'running' | 'done';
  commit: DeferredDelete['commit'];
  /** The snackbar that offers "Undo". */
  snackId: number;
  run?: Promise<void>;
};

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [queue, setQueue] = useState<Snack[]>([]);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const queueRef = useRef<Snack[]>([]);
  const nextId = useRef(1);
  const deletes = useRef(new Map<string, Pending>());
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const setQ = useCallback((f: (q: Snack[]) => Snack[]) => {
    queueRef.current = f(queueRef.current);
    setQueue(queueRef.current);
  }, []);

  const dismiss = useCallback(
    (id: number, reason: DismissReason) => {
      const s = queueRef.current.find((x) => x.id === id);
      if (!s) return;
      setQ((q) => q.filter((x) => x.id !== id));
      s.onDismiss?.(reason);
    },
    [setQ],
  );

  const show = useCallback(
    (message: string, opts: SnackOptions = {}) => {
      const current = queueRef.current[0];
      const id = nextId.current++;
      setQ((q) => [...q, { ...opts, id, message }]);
      // A pending "Undo" gives way: its deletion runs and the new message shows now.
      if (current?.action) dismiss(current.id, 'replaced');
      return id;
    },
    [setQ, dismiss],
  );

  const unhide = useCallback((key: string) => {
    setPending((p) => {
      const n = new Set(p);
      n.delete(key);
      return n;
    });
  }, []);

  const run = useCallback(
    (key: string, keepalive: boolean) => {
      const p = deletes.current.get(key);
      if (!p || p.state !== 'waiting') return p?.run ?? Promise.resolve();
      p.state = 'running';
      p.run = p
        .commit({ keepalive })
        .then(
          () => undefined,
          (e: unknown) => void show(errorText(e, tRef.current), { kind: 'error' }),
        )
        .finally(() => {
          p.state = 'done';
          deletes.current.delete(key);
          unhide(key);
        });
      return p.run;
    },
    [show, unhide],
  );

  const deferDelete = useCallback(
    ({ key, message, commit, onUndo }: DeferredDelete) => {
      // Deleting the same item twice keeps the first, still pending, deletion.
      if (deletes.current.has(key)) return;
      const entry: Pending = { state: 'waiting', commit, snackId: 0 };
      deletes.current.set(key, entry);
      setPending((p) => new Set(p).add(key));
      entry.snackId = show(message, {
        duration: SNACK_ACTION_DURATION,
        action: {
          label: tRef.current('common.undo'),
          onAction: () => {
            const p = deletes.current.get(key);
            if (p?.state !== 'waiting') return;
            p.state = 'done';
            deletes.current.delete(key);
            unhide(key);
            onUndo?.();
          },
        },
        onDismiss: (reason) => {
          if (reason !== 'action') void run(key, false);
        },
      });
    },
    [show, run, unhide],
  );

  const flush = useCallback(
    async ({ keepalive = false, timeoutMs }: FlushOptions = {}) => {
      const runs = [...deletes.current.entries()].map(([key, p]) => {
        const done = run(key, keepalive);
        // Already running: its snackbar goes without running it again.
        dismiss(p.snackId, 'flush');
        return done;
      });
      const all = Promise.all(runs).then(() => undefined);
      if (timeoutMs === undefined) return all;
      let timer: number | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, timeoutMs);
      });
      await Promise.race([all, timeout]);
      clearTimeout(timer);
    },
    [run, dismiss],
  );

  // Leaving the page (or the tab going to the background) commits what is pending.
  useEffect(() => {
    const now = () => void flush({ keepalive: true });
    const onVisibility = () => document.visibilityState === 'hidden' && now();
    window.addEventListener('pagehide', now);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', now);
      document.removeEventListener('visibilitychange', onVisibility);
      now();
    };
  }, [flush]);

  const current = queue[0];
  // Hovering or focusing a message pauses its timer (WCAG 2.2.1); the next message starts unpaused.
  const [pausedId, setPausedId] = useState<number | null>(null);
  const paused = !!current && pausedId === current.id;
  useEffect(() => {
    if (!current || paused) return;
    const ms = current.duration ?? (current.action ? SNACK_ACTION_DURATION : SNACK_DURATION);
    const timer = window.setTimeout(() => dismiss(current.id, 'timeout'), ms);
    return () => clearTimeout(timer);
  }, [current, paused, dismiss]);

  const value = useMemo(() => ({ show, deferDelete, flush, pending }), [show, deferDelete, flush, pending]);
  return (
    <SnackCtx.Provider value={value}>
      {children}
      <SnackbarHost
        snack={current}
        onPause={(p) => setPausedId(p && current ? current.id : null)}
        onAction={(s) => {
          dismiss(s.id, 'action');
          s.action?.onAction();
        }}
        onClose={(s) => dismiss(s.id, 'close')}
      />
    </SnackCtx.Provider>
  );
}
/** The previous name of the provider. */
export const ToastProvider = SnackbarProvider;

/**
 * Lives inside the topmost modal dialog when there is one (the rest of the page is inert then), otherwise
 * in the body. The live regions are always there, so a new message is announced: errors as alerts.
 */
function SnackbarHost({
  snack,
  onPause,
  onAction,
  onClose,
}: {
  snack: Snack | undefined;
  onPause: (paused: boolean) => void;
  onAction: (s: Snack) => void;
  onClose: (s: Snack) => void;
}) {
  const { t } = useI18n();
  const container = useTopModal() ?? document.body;
  // A live region only announces changes made after it is in the page. When the host moves (a dialog
  // opens or closes, maybe in the same event as the message), its regions go in empty and the message
  // follows a frame later.
  const [readyIn, setReadyIn] = useState<Element | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReadyIn(container));
    return () => cancelAnimationFrame(frame);
  }, [container]);
  const body = (kind: 'info' | 'error') =>
    readyIn === container && snack && (snack.kind ?? 'info') === kind ? (
      <div
        key={snack.id}
        className={`snackbar ${kind}`}
        onMouseEnter={() => onPause(true)}
        onMouseLeave={() => onPause(false)}
        onFocus={() => onPause(true)}
        onBlur={() => onPause(false)}
      >
        <span className="msg">{snack.message}</span>
        {snack.action && (
          <button type="button" className="btn sm" onClick={() => onAction(snack)}>
            {snack.action.label}
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={t('common.close')}
          onClick={() => onClose(snack)}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    ) : null;
  return createPortal(
    <div className="snackbar-host">
      <div role="status">{body('info')}</div>
      <div role="alert">{body('error')}</div>
    </div>,
    container,
  );
}
