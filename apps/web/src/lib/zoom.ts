/**
 * Zoom and pan of the cover viewer, as plain numbers (testable without a browser). The image is laid out
 * centred in the stage at `base` size and shown with `translate(x, y) scale(scale)` around its centre.
 */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
/** What a double click or a keyboard "zoom in" from the fitted image goes to. */
export const STEP_ZOOM = 2.5;

export type View = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };
export const FITTED: View = { scale: 1, x: 0, y: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keeps the image covering the stage where it is larger than it, and centred where it is not. */
export function clampPan(v: View, base: Size, stage: Size): View {
  const maxX = Math.max(0, (base.width * v.scale - stage.width) / 2);
  const maxY = Math.max(0, (base.height * v.scale - stage.height) / 2);
  return { scale: v.scale, x: clamp(v.x, -maxX, maxX), y: clamp(v.y, -maxY, maxY) };
}

/**
 * Zooms to `scale` keeping the point at (`px`, `py`) (relative to the stage centre) where it is, as a
 * wheel or a pinch does around the pointer.
 */
export function zoomAt(v: View, scale: number, px: number, py: number, base: Size, stage: Size): View {
  const s = clamp(scale, MIN_ZOOM, MAX_ZOOM);
  const k = s / v.scale;
  return clampPan({ scale: s, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, base, stage);
}

export const panBy = (v: View, dx: number, dy: number, base: Size, stage: Size): View =>
  clampPan({ ...v, x: v.x + dx, y: v.y + dy }, base, stage);

/** How far down a swipe on the fitted image has to go to close the viewer (as on Android). */
export const SWIPE_CLOSE = 120;
