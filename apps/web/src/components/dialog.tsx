/**
 * Dialogs on the native <dialog> element opened with showModal(): the browser traps the focus, makes the
 * rest of the page inert and puts the dialog in the top layer, so a dialog opened over a side panel (or over
 * another dialog) just works. Each one gives the focus back to the element that opened it.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useI18n } from '../i18n';
import { Icon } from './ui';

// ---------- Open modal dialogs, topmost last ----------
// The snackbar renders inside the topmost one: anything outside a modal dialog is inert.
const stack: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function pushModal(d: HTMLDialogElement) {
  stack.push(d);
  emit();
  return () => {
    const i = stack.lastIndexOf(d);
    if (i >= 0) stack.splice(i, 1);
    emit();
  };
}
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
/** The topmost open modal dialog, or null. */
export const useTopModal = () => useSyncExternalStore(subscribe, () => stack.at(-1) ?? null);

/** A click on the dialog's ::backdrop is dispatched to the dialog itself, outside its box. */
function onBackdrop(d: HTMLDialogElement, e: MouseEvent) {
  if (e.target !== d) return false;
  const r = d.getBoundingClientRect();
  const inside =
    r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  return !inside;
}

/** The latest value of a prop, for native listeners that are attached once. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Opens `d` as a modal while mounted (or while `active`) and wires Escape, the backdrop and a close the
 * browser forces. Listeners are native: React would propagate a nested dialog's cancel to its parent.
 */
function useModal(
  ref: React.RefObject<HTMLDialogElement | null>,
  active: boolean,
  handlers: React.RefObject<{ dismiss: () => void; forcedClose: (d: HTMLDialogElement) => void }>,
  focus: (d: HTMLDialogElement) => void,
) {
  const focusRef = useLatest(focus);
  useEffect(() => {
    const d = ref.current;
    if (!active || !d) return;
    const opener = document.activeElement;
    let closing = false;
    if (!d.open) d.showModal();
    focusRef.current(d);
    const unregister = pushModal(d);
    let downOnBackdrop = false;
    const onCancel = (e: Event) => {
      if (e.target !== d) return;
      e.preventDefault();
      handlers.current.dismiss();
    };
    // Some browsers do not let a repeated Escape be cancelled: the dialog closes anyway. The close event
    // comes a task later: one from an earlier close (StrictMode runs this effect, its cleanup and the
    // effect again) finds the dialog open again and is ignored.
    const onClose = (e: Event) => {
      if (e.target === d && !closing && !d.open) handlers.current.forcedClose(d);
    };
    const onDown = (e: MouseEvent) => {
      downOnBackdrop = onBackdrop(d, e);
    };
    // Only a press that starts and ends on the backdrop: selecting text and releasing outside does not close.
    const onClick = (e: MouseEvent) => {
      if (downOnBackdrop && onBackdrop(d, e)) handlers.current.dismiss();
      downOnBackdrop = false;
    };
    d.addEventListener('cancel', onCancel);
    d.addEventListener('close', onClose);
    d.addEventListener('mousedown', onDown);
    d.addEventListener('click', onClick);
    return () => {
      d.removeEventListener('cancel', onCancel);
      d.removeEventListener('close', onClose);
      d.removeEventListener('mousedown', onDown);
      d.removeEventListener('click', onClick);
      unregister();
      closing = true;
      if (d.open) d.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [active, ref, handlers, focusRef]);
}

/** Closing the dialog as Escape or ✕ would: asks first when there are unsaved changes. */
const RequestClose = createContext<() => void>(() => undefined);

/** The footer's Cancel button: it asks before discarding unsaved changes, like Escape and ✕. */
export function DialogCancel({ children }: { children: ReactNode }) {
  const requestClose = useContext(RequestClose);
  return (
    <button type="button" className="btn ghost" onClick={requestClose}>
      {children}
    </button>
  );
}

const FIELD =
  ':scope > .modal-body :is(input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]))';

/**
 * A modal dialog with a title, a scrolling body and an optional footer. Escape, the ✕ button and a click on
 * the backdrop close it; with `dirty` they first ask whether to discard the changes. Focus goes to the
 * element marked `data-autofocus`, otherwise to the first field.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  dirty = false,
  alert = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** There are unsaved changes: closing without saving asks first. */
  dirty?: boolean;
  /** An alert dialog (a confirmation): the body describes it. */
  alert?: boolean;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [confirming, setConfirming] = useState(false);
  const latest = useLatest({ onClose, dirty });
  const requestClose = useCallback(() => {
    if (latest.current.dirty) setConfirming(true);
    else latest.current.onClose();
  }, [latest]);
  const handlers = useLatest({
    dismiss: requestClose,
    forcedClose: (d: HTMLDialogElement) => {
      if (!latest.current.dirty) return latest.current.onClose();
      d.showModal();
      setConfirming(true);
    },
  });
  useModal(ref, true, handlers, (d) =>
    (d.querySelector<HTMLElement>('[data-autofocus]') ?? d.querySelector<HTMLElement>(FIELD))?.focus(),
  );

  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      role={alert ? 'alertdialog' : undefined}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={alert ? bodyId : undefined}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-btn" onClick={requestClose} aria-label={t('common.close')}>
          <Icon name="x" />
        </button>
      </header>
      <RequestClose.Provider value={requestClose}>
        <div className="modal-body" id={bodyId}>
          {children}
        </div>
        {footer && <footer>{footer}</footer>}
      </RequestClose.Provider>
      {confirming && (
        <ConfirmDialog
          title={t('form.discardTitle')}
          text={t('form.discardText')}
          cancelLabel={t('form.keepEditing')}
          confirmLabel={t('form.discard')}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            latest.current.onClose();
          }}
        />
      )}
    </dialog>
  );
}

/**
 * A question before something that cannot be undone. The safe answer (cancel) has the focus; the
 * confirming button is in the error colour when `destructive`.
 */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  cancelLabel,
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  text?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal
      title={title}
      onClose={onCancel}
      alert
      footer={
        <>
          <button type="button" className="btn ghost" data-autofocus onClick={onCancel}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            className={`btn ${destructive ? 'destructive' : 'primary'}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {text && <p>{text}</p>}
    </Modal>
  );
}

/**
 * A side panel (book or wish details) as a modal dialog on the right. The URL stays the source of truth:
 * `open` follows it, and Escape, the backdrop and the ✕ call `onClose`, which changes it.
 */
export function SidePanel({
  open,
  onClose,
  label,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name while there is no heading to point at (loading, error). */
  label: string;
  labelledBy?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const handlers = useLatest({ dismiss: onClose, forcedClose: () => onClose() });
  // The panel itself takes the focus: its name is announced and Tab goes on to its first control.
  useModal(ref, open, handlers, (d) => d.focus());
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-modal="true"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      tabIndex={-1}
    >
      {/* The panel moves in, not the dialog: a moving dialog would carry the snackbar rendered in it. */}
      <div className="drawer-panel">{children}</div>
    </dialog>
  );
}
