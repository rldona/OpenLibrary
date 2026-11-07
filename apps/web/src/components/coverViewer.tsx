/**
 * The full-size cover in a dialog that fills the window, as on Android: zoom with the wheel, a pinch, a
 * double click or + and −; drag (or the arrow keys) to move a zoomed cover; Escape or ✕ close it, and on
 * a touch screen dragging the fitted cover down closes it too.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useI18n } from '../i18n';
import {
  clampPan,
  FITTED,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  STEP_ZOOM,
  SWIPE_CLOSE,
  zoomAt,
  type Size,
  type View,
} from '../lib/zoom';
import { FullDialog } from './dialog';
import { Spinner } from './states';
import { Icon } from './ui';

type Pointer = { x: number; y: number; type: string };

export function CoverViewer({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const { t } = useI18n();
  const helpId = useId();
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(FITTED);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  /** The downward drag of a swipe-to-close, in pixels. */
  const [swipe, setSwipeState] = useState(0);
  // Also kept in a ref: the pointer handlers read it between renders.
  const swipeRef = useRef(0);
  const setSwipe = (f: (s: number) => number) => {
    swipeRef.current = f(swipeRef.current);
    setSwipeState(swipeRef.current);
  };
  const pointers = useRef(new Map<number, Pointer>());
  const gesture = useRef<{ dist: number; scale: number } | null>(null);

  const sizes = (): { base: Size; stage: Size; cx: number; cy: number } => {
    const s = stage.current?.getBoundingClientRect();
    return {
      base: { width: img.current?.offsetWidth ?? 0, height: img.current?.offsetHeight ?? 0 },
      stage: { width: s?.width ?? 0, height: s?.height ?? 0 },
      cx: (s?.left ?? 0) + (s?.width ?? 0) / 2,
      cy: (s?.top ?? 0) + (s?.height ?? 0) / 2,
    };
  };
  const zoomTo = (scale: number, clientX?: number, clientY?: number) => {
    const z = sizes();
    setView((v) =>
      zoomAt(
        v,
        scale,
        clientX === undefined ? 0 : clientX - z.cx,
        clientY === undefined ? 0 : clientY - z.cy,
        z.base,
        z.stage,
      ),
    );
  };

  // The wheel needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const z = sizes();
      setView((v) =>
        zoomAt(v, v.scale * Math.exp(-e.deltaY * 0.002), e.clientX - z.cx, e.clientY - z.cy, z.base, z.stage),
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  // A new window size keeps the cover inside it.
  useEffect(() => {
    const onResize = () => {
      const z = sizes();
      setView((v) => clampPan(v, z.base, z.stage));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function onPointerDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    stage.current?.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Pointer, Pointer];
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
      setSwipe(() => 0);
    }
  }

  function onPointerMove(e: PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY, type: prev.type };
    pointers.current.set(e.pointerId, now);
    const z = sizes();
    if (pointers.current.size === 2 && gesture.current) {
      // Pinch: the scale follows the distance between the fingers, around their midpoint.
      const [a, b] = [...pointers.current.values()] as [Pointer, Pointer];
      const scale = (gesture.current.scale * Math.hypot(a.x - b.x, a.y - b.y)) / (gesture.current.dist || 1);
      setView((v) => zoomAt(v, scale, (a.x + b.x) / 2 - z.cx, (a.y + b.y) / 2 - z.cy, z.base, z.stage));
      return;
    }
    const dx = now.x - prev.x;
    const dy = now.y - prev.y;
    if (view.scale > MIN_ZOOM) setView((v) => panBy(v, dx, dy, z.base, z.stage));
    else if (prev.type === 'touch') setSwipe((s) => Math.max(0, s + dy));
  }

  function onPointerUp(e: PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 0 && swipeRef.current) {
      if (swipeRef.current > SWIPE_CLOSE) onClose();
      else setSwipe(() => 0);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const z = sizes();
    const step = e.shiftKey ? 120 : 40;
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (e.key === '+' || e.key === '=') zoomTo(view.scale < STEP_ZOOM ? STEP_ZOOM : view.scale * 1.5);
    else if (e.key === '-') zoomTo(view.scale / 1.5);
    else if (e.key === '0') setView(FITTED);
    else if (pan[e.key] && view.scale > MIN_ZOOM) setView((v) => panBy(v, ...pan[e.key]!, z.base, z.stage));
    else return;
    e.preventDefault();
  }

  const zoomed = view.scale > MIN_ZOOM;
  return (
    <FullDialog label={t('cover.alt', { title })} onClose={onClose} className="viewer">
      <div className="viewer-bar" style={{ opacity: swipe ? Math.max(0, 1 - swipe / 300) : undefined }}>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('cover.zoomOut')}
          // aria-disabled, not disabled: the focus stays on a button that has just become unusable.
          aria-disabled={!zoomed}
          onClick={() => zoomed && zoomTo(view.scale / 1.5)}
        >
          <Icon name="zoomOut" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('cover.zoomIn')}
          aria-disabled={view.scale >= MAX_ZOOM}
          onClick={() =>
            view.scale < MAX_ZOOM && zoomTo(view.scale < STEP_ZOOM ? STEP_ZOOM : view.scale * 1.5)
          }
        >
          <Icon name="zoomIn" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('cover.zoomReset')}
          aria-disabled={!zoomed}
          onClick={() => zoomed && setView(FITTED)}
        >
          <Icon name="expand" />
        </button>
        <span className="grow" />
        <button
          type="button"
          className="icon-btn"
          aria-label={t('common.close')}
          data-autofocus
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </div>
      <div
        ref={stage}
        className={`viewer-stage ${zoomed ? 'zoomed' : ''}`}
        // Focusable, so the keys zoom and move; the help says how.
        tabIndex={0}
        role="group"
        aria-label={t('cover.alt', { title })}
        aria-describedby={helpId}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => (zoomed ? setView(FITTED) : zoomTo(STEP_ZOOM, e.clientX, e.clientY))}
      >
        {!loaded && !failed && <Spinner />}
        {failed ? (
          <p className="viewer-failed">{t('crop.loadFailed')}</p>
        ) : (
          <img
            ref={img}
            src={src}
            alt=""
            draggable={false}
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            style={{
              transform: `translate(${view.x}px, ${view.y + swipe}px) scale(${view.scale})`,
              opacity: swipe ? Math.max(0.3, 1 - swipe / 400) : undefined,
              visibility: loaded ? undefined : 'hidden',
            }}
          />
        )}
        <span id={helpId} className="sr-only">
          {t('cover.viewerHelp')}
        </span>
      </div>
    </FullDialog>
  );
}

/**
 * A cover that opens the viewer when there is a real one to see (`src`, the full-size image); a generated
 * cover is shown as it is.
 */
export function CoverButton({
  src,
  title,
  children,
}: {
  src: string | null;
  title: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!src) return <>{children}</>;
  return (
    <>
      <button type="button" className="cover-open" aria-label={t('cover.open')} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && <CoverViewer src={src} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}
