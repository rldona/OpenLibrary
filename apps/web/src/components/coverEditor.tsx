/**
 * The cover crop editor (as the Android app's ui/capture/CoverEditor.kt), opened after choosing a picture:
 * a 2:3 crop by default or a free one, quarter turns and straightening (−45°..45°) without empty corners,
 * then a JPEG of at most 1600 px is what gets uploaded. The geometry lives in lib/coverEdit.ts.
 *
 * Pointer: drag inside the crop to move it, its edges or corners to resize it. Keyboard: the arrows on
 * the crop move it and on its corner resize it; Shift takes bigger steps.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  COVER_RATIO,
  heightOf,
  hitTest,
  initialEditState,
  resizeCrop,
  rotateQuarter,
  setRatioLocked,
  straighten,
  widthOf,
  workSizeOf,
  type CoverEditState,
  type CropHandle,
  type Rect,
} from '../lib/coverEdit';
import { decodeImage, drawWork, renderCrop, type Picture } from '../lib/image';
import { useI18n } from '../i18n';
import { DialogCancel, Modal } from './dialog';
import { Segmented } from './segmented';
import { BusyLabel, LoadingState } from './states';
import { Banner, Icon } from './ui';

const HANDLES: CropHandle[] = [
  'topLeft',
  'top',
  'topRight',
  'right',
  'bottomRight',
  'bottom',
  'bottomLeft',
  'left',
];
/** Touch target around an edge, in screen pixels. */
const SLOP = 22;

export function CoverEditor({
  file,
  onCancel,
  onDone,
}: {
  file: Blob;
  onCancel: () => void;
  /** The cropped cover, as a JPEG file. */
  onDone: (cover: File) => void;
}) {
  const { t } = useI18n();
  const helpId = useId();
  const [picture, setPicture] = useState<Picture | null>(null);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState<CoverEditState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    let pic: Picture | null = null;
    decodeImage(file).then(
      (p) => {
        pic = p;
        if (!alive) return p.close?.();
        setPicture(p);
        setState(initialEditState(p.width, p.height));
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      pic?.close?.();
    };
  }, [file]);

  async function apply() {
    if (!picture || !state) return;
    setBusy(true);
    try {
      const blob = await renderCrop(picture, state);
      onDone(new File([blob], 'cover.jpg', { type: 'image/jpeg' }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('capture.cropTitle')}
      onClose={onCancel}
      wide
      dirty={false}
      footer={
        <>
          <DialogCancel>{t('common.cancel')}</DialogCancel>
          <button
            type="button"
            className="btn primary"
            disabled={!state || busy}
            onClick={() => void apply()}
          >
            <BusyLabel busy={busy} busyText={t('common.saving')}>
              <Icon name="crop" size={16} /> {t('crop.apply')}
            </BusyLabel>
          </button>
        </>
      }
    >
      {failed && <Banner kind="err">{state ? t('capture.cropFailed') : t('crop.loadFailed')}</Banner>}
      {!state && !failed && <LoadingState />}
      {picture && state && (
        <>
          <CropStage picture={picture} state={state} onChange={setState} helpId={helpId} />
          <p id={helpId} className="muted small">
            {t('crop.help')}
          </p>
          <div className="crop-tools">
            <Segmented<'cover' | 'free'>
              label={t('crop.ratio')}
              value={state.ratioLocked ? 'cover' : 'free'}
              onChange={(v) => setState((s) => s && setRatioLocked(s, v === 'cover'))}
              options={[
                { value: 'cover', label: t('crop.cover') },
                { value: 'free', label: t('crop.free') },
              ]}
            />
            <button type="button" className="btn" onClick={() => setState((s) => s && rotateQuarter(s))}>
              <Icon name="rotate" size={16} /> {t('capture.rotate')}
            </button>
            <label className="crop-angle">
              {t('capture.straighten')}
              <input
                type="range"
                min={-45}
                max={45}
                step={0.5}
                value={state.angleDeg}
                aria-valuetext={t('crop.degrees', { n: state.angleDeg })}
                onChange={(e) => setState((s) => s && straighten(s, Number(e.target.value)))}
              />
              <output>{t('crop.degrees', { n: state.angleDeg })}</output>
            </label>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setState(initialEditState(picture.width, picture.height))}
            >
              {t('crop.reset')}
            </button>
          </div>
          <p className="sr-only" aria-live="polite">
            {t('crop.size', {
              w: Math.round(widthOf(state.crop)),
              h: Math.round(heightOf(state.crop)),
              x: Math.round(state.crop.left),
              y: Math.round(state.crop.top),
            })}
          </p>
        </>
      )}
    </Modal>
  );
}

function CropStage({
  picture,
  state,
  onChange,
  helpId,
}: {
  picture: Picture;
  state: CoverEditState;
  onChange: (s: CoverEditState) => void;
  helpId: string;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [room, setRoom] = useState({ width: 640, height: 480 });
  const [w, h] = workSizeOf(state);
  // The work image fitted in the room available (screen pixels per work pixel).
  const scale = Math.min(room.width / w, room.height / h) || 1;
  const drag = useRef<{ handle: CropHandle; x: number; y: number; crop: Rect } | null>(null);
  const ratio = state.ratioLocked ? COVER_RATIO : null;
  const minSize = Math.max(40, Math.min(w, h) * 0.05);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setRoom({ width: r.width, height: r.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * scale * dpr);
    c.height = Math.round(h * scale * dpr);
    drawWork(ctx, picture, state, scale * dpr);
  }, [picture, state, w, h, scale]);

  const resize = (handle: CropHandle, dx: number, dy: number, from = state.crop) =>
    onChange({ ...state, crop: resizeCrop(from, handle, dx, dy, ratio, minSize, w, h, state.angleDeg) });

  const toWork = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  function onPointerDown(e: PointerEvent) {
    const p = toWork(e);
    const handle = hitTest(state.crop, p.x, p.y, SLOP / scale);
    if (!handle) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { handle, x: p.x, y: p.y, crop: state.crop };
  }
  function onPointerMove(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toWork(e);
    // From where the drag started, so rounding never adds up.
    resize(d.handle, p.x - d.x, p.y - d.y, d.crop);
  }
  const onPointerUp = () => {
    drag.current = null;
  };

  /** Arrow keys: 1 % of the picture per press, 10 % with Shift. */
  const keyStep = (e: KeyboardEvent): [number, number] | null => {
    const step = Math.max(w, h) * (e.shiftKey ? 0.1 : 0.01);
    const dirs: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    return dirs[e.key] ?? null;
  };
  const onKey = (handle: CropHandle) => (e: KeyboardEvent) => {
    const d = keyStep(e);
    if (!d) return;
    e.preventDefault();
    let [dx, dy] = d;
    // On the corner with the 2:3 lock, a step changes the width (left/right) or the height (up/down) by
    // exactly that much: the drag goes along the corner's diagonal.
    if (handle !== 'move' && ratio) [dx, dy] = dx ? [dx, dx / ratio] : [dy * ratio, dy];
    resize(handle, dx, dy);
  };

  const c = state.crop;
  const style = {
    left: c.left * scale,
    top: c.top * scale,
    width: widthOf(c) * scale,
    height: heightOf(c) * scale,
  };
  return (
    <div className="crop-room" ref={box}>
      <div
        className="crop-stage"
        style={{ width: w * scale, height: h * scale }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas ref={canvas} style={{ width: w * scale, height: h * scale }} aria-hidden />
        <button
          type="button"
          className="crop-box"
          style={style}
          aria-label={t('capture.cropArea')}
          aria-describedby={helpId}
          onKeyDown={onKey('move')}
        >
          {HANDLES.map((hd) => (
            <span key={hd} className={`crop-handle h-${hd}`} aria-hidden />
          ))}
        </button>
        <button
          type="button"
          className="crop-corner"
          style={{ left: style.left + style.width, top: style.top + style.height }}
          aria-label={t('crop.corner')}
          aria-describedby={helpId}
          onKeyDown={onKey('bottomRight')}
        />
      </div>
    </div>
  );
}
