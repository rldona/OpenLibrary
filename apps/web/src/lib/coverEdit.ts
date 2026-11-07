/**
 * The cover crop editor's geometry, ported from the Android app's core/CoverEdit.kt (same rules, same
 * tests in test/coverEdit.test.ts): plain numbers, no DOM, so it is testable on its own.
 *
 * The source image (`imageWidth` x `imageHeight`, already upright) is turned clockwise `quarterTurns`
 * times, which gives the "work" image (`workSize`). That image is then straightened by `angleDeg`
 * (clockwise, around its centre). `crop` is a rectangle aligned with the screen, in work-image pixels, and
 * always lies inside the straightened image.
 */

/** Width / height of a book cover. */
export const COVER_RATIO = 2 / 3;

export type Rect = { left: number; top: number; right: number; bottom: number };
export const rect = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
});
export const widthOf = (r: Rect) => r.right - r.left;
export const heightOf = (r: Rect) => r.bottom - r.top;
const centerX = (r: Rect) => (r.left + r.right) / 2;
const centerY = (r: Rect) => (r.top + r.bottom) / 2;
const offset = (r: Rect, dx: number, dy: number) =>
  rect(r.left + dx, r.top + dy, r.right + dx, r.bottom + dy);
const around = (cx: number, cy: number, w: number, h: number) =>
  rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);

/** What a drag on the crop editor moves: the whole crop, one edge or one corner. */
export const CROP_HANDLES = [
  'move',
  'left',
  'top',
  'right',
  'bottom',
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
] as const;
export type CropHandle = (typeof CROP_HANDLES)[number];

export type CoverEditState = {
  imageWidth: number;
  imageHeight: number;
  crop: Rect;
  quarterTurns: number;
  angleDeg: number;
  ratioLocked: boolean;
};

/** A 2D affine transform: x' = a·x + b·y + c, y' = d·x + e·y + f. */
export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };
export const affine = (a: number, b: number, c: number, d: number, e: number, f: number): Affine => ({
  a,
  b,
  c,
  d,
  e,
  f,
});
export const IDENTITY = affine(1, 0, 0, 0, 1, 0);
export const mapPoint = (m: Affine, x: number, y: number): [number, number] => [
  m.a * x + m.b * y + m.c,
  m.d * x + m.e * y + m.f,
];
/** `m` followed by `next` (not named `then`: a module exporting `then` is a thenable to `import()`). */
export const compose = (m: Affine, next: Affine): Affine =>
  affine(
    next.a * m.a + next.b * m.d,
    next.a * m.b + next.b * m.e,
    next.a * m.c + next.b * m.f + next.c,
    next.d * m.a + next.e * m.d,
    next.d * m.b + next.e * m.e,
    next.d * m.c + next.e * m.f + next.f,
  );
export const translate = (x: number, y: number) => affine(1, 0, x, 0, 1, y);
/** Clockwise (on a y-down screen) rotation by `deg` around (`cx`, `cy`). */
export function rotate(deg: number, cx: number, cy: number): Affine {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return compose(compose(translate(-cx, -cy), affine(cos, -sin, 0, sin, cos, 0)), translate(cx, cy));
}

const mod4 = (n: number) => ((n % 4) + 4) % 4;

export const workSize = (width: number, height: number, quarterTurns: number): [number, number] =>
  mod4(quarterTurns) % 2 === 0 ? [width, height] : [height, width];
export const workSizeOf = (s: CoverEditState) => workSize(s.imageWidth, s.imageHeight, s.quarterTurns);

/** The largest rectangle of `ratio` (width / height) centred in `w` x `h`. */
export function centeredCrop(w: number, h: number, ratio: number): Rect {
  const cw = Math.min(w, h * ratio);
  return around(w / 2, h / 2, cw, cw / ratio);
}

/** The largest rectangle of `ratio` centred inside `r`. */
const ratioInside = (r: Rect, ratio: number) =>
  offset(centeredCrop(widthOf(r), heightOf(r), ratio), r.left, r.top);

const EPS = 0.05;

/** Whether `crop` lies inside a `w` x `h` image straightened by `angleDeg` around its centre. */
export function cropFits(crop: Rect, w: number, h: number, angleDeg: number): boolean {
  // Take the crop's corners back into the unrotated image and check they land inside it.
  const back = rotate(-angleDeg, w / 2, h / 2);
  const corners: [number, number][] = [
    [crop.left, crop.top],
    [crop.right, crop.top],
    [crop.left, crop.bottom],
    [crop.right, crop.bottom],
  ];
  return corners.every(([x, y]) => {
    const [u, v] = mapPoint(back, x, y);
    return u >= -EPS && v >= -EPS && u <= w + EPS && v <= h + EPS;
  });
}

/** The largest t in 0..1 for which `fits` holds, assuming the valid values form an interval from 0. */
function furthest(fits: (t: number) => boolean): number {
  if (fits(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Makes `crop` fit after the image is straightened to `angleDeg`: it shrinks around its centre keeping its
 * proportion, and its centre slides towards the image centre when that leaves a larger crop (or when the
 * centre itself fell outside the image).
 */
export function fitAfterRotation(crop: Rect, w: number, h: number, angleDeg: number): Rect {
  if (cropFits(crop, w, h, angleDeg)) return crop;
  let best: Rect | null = null;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const cx = centerX(crop) + (w / 2 - centerX(crop)) * t;
    const cy = centerY(crop) + (h / 2 - centerY(crop)) * t;
    if (!cropFits(rect(cx, cy, cx, cy), w, h, angleDeg)) continue;
    const k = furthest((k) =>
      cropFits(around(cx, cy, widthOf(crop) * k, heightOf(crop) * k), w, h, angleDeg),
    );
    const candidate = around(cx, cy, widthOf(crop) * k, heightOf(crop) * k);
    if (!best || widthOf(candidate) > widthOf(best) * 1.001) best = candidate;
  }
  return best ?? around(w / 2, h / 2, 0, 0);
}

/** Moves `crop` by (`dx`, `dy`) as far as it stays inside the image, sliding along the edges it meets. */
export function moveCrop(crop: Rect, dx: number, dy: number, w: number, h: number, angleDeg: number): Rect {
  const alongX = offset(crop, dx * furthest((t) => cropFits(offset(crop, dx * t, 0), w, h, angleDeg)), 0);
  return offset(alongX, 0, dy * furthest((t) => cropFits(offset(alongX, 0, dy * t), w, h, angleDeg)));
}

const horizontalSign = (h: CropHandle) =>
  h === 'left' || h === 'topLeft' || h === 'bottomLeft'
    ? -1
    : h === 'right' || h === 'topRight' || h === 'bottomRight'
      ? 1
      : 0;
const verticalSign = (h: CropHandle) =>
  h === 'top' || h === 'topLeft' || h === 'topRight'
    ? -1
    : h === 'bottom' || h === 'bottomLeft' || h === 'bottomRight'
      ? 1
      : 0;

/** `handle` dragged by (`dx`, `dy`) without regard for the image bounds; sides never go below `minSize`. */
function dragHandle(
  crop: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null,
  minSize: number,
): Rect {
  const sx = horizontalSign(handle);
  const sy = verticalSign(handle);
  if (ratio === null) {
    const left = sx < 0 ? Math.min(crop.left + dx, crop.right - minSize) : crop.left;
    const right = sx > 0 ? Math.max(crop.right + dx, crop.left + minSize) : crop.right;
    const top = sy < 0 ? Math.min(crop.top + dy, crop.bottom - minSize) : crop.top;
    const bottom = sy > 0 ? Math.max(crop.bottom + dy, crop.top + minSize) : crop.bottom;
    return rect(left, top, right, bottom);
  }
  const raw =
    sx !== 0 && sy !== 0
      ? // A corner follows the drag projected on its diagonal, so the size changes smoothly.
        widthOf(crop) + ((sx * dx * ratio + sy * dy) * ratio) / (ratio * ratio + 1)
      : sx !== 0
        ? widthOf(crop) + sx * dx
        : (heightOf(crop) + sy * dy) * ratio;
  const width = Math.max(raw, Math.max(minSize, minSize * ratio));
  const height = width / ratio;
  const left = sx < 0 ? crop.right - width : sx > 0 ? crop.left : centerX(crop) - width / 2;
  const top = sy < 0 ? crop.bottom - height : sy > 0 ? crop.top : centerY(crop) - height / 2;
  return rect(left, top, left + width, top + height);
}

/**
 * Drags `handle` by (`dx`, `dy`) in work-image pixels, as far as the crop stays inside the straightened
 * image. With a `ratio` every handle keeps it; without one, corners move each axis on its own so they
 * slide along the edges.
 */
export function resizeCrop(
  crop: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null,
  minSize: number,
  w: number,
  h: number,
  angleDeg: number,
): Rect {
  if (handle === 'move') return moveCrop(crop, dx, dy, w, h, angleDeg);
  const along = (from: Rect, ddx: number, ddy: number) => {
    if (!cropFits(dragHandle(from, handle, 0, 0, ratio, minSize), w, h, angleDeg)) return from;
    const t = furthest((t) =>
      cropFits(dragHandle(from, handle, ddx * t, ddy * t, ratio, minSize), w, h, angleDeg),
    );
    return dragHandle(from, handle, ddx * t, ddy * t, ratio, minSize);
  };
  return ratio === null ? along(along(crop, dx, 0), 0, dy) : along(crop, dx, dy);
}

/** Which part of `crop` a touch at (`x`, `y`) grabs, within `slop` pixels of an edge, or null if none. */
export function hitTest(crop: Rect, x: number, y: number, slop: number): CropHandle | null {
  if (x < crop.left - slop || x > crop.right + slop || y < crop.top - slop || y > crop.bottom + slop)
    return null;
  const toLeft = Math.abs(x - crop.left);
  const toRight = Math.abs(x - crop.right);
  const toTop = Math.abs(y - crop.top);
  const toBottom = Math.abs(y - crop.bottom);
  const sx = Math.min(toLeft, toRight) > slop ? 0 : toLeft <= toRight ? -1 : 1;
  const sy = Math.min(toTop, toBottom) > slop ? 0 : toTop <= toBottom ? -1 : 1;
  if (sx < 0 && sy < 0) return 'topLeft';
  if (sx > 0 && sy < 0) return 'topRight';
  if (sx < 0 && sy > 0) return 'bottomLeft';
  if (sx > 0 && sy > 0) return 'bottomRight';
  if (sx < 0) return 'left';
  if (sx > 0) return 'right';
  if (sy < 0) return 'top';
  if (sy > 0) return 'bottom';
  return 'move';
}

/**
 * The editor's starting point for a `width` x `height` picture: the largest 2:3 crop inside `frame` (in
 * image pixels), or centred on the whole picture when there is no usable frame.
 */
export function initialEditState(width: number, height: number, frame?: Rect | null): CoverEditState {
  const whole = centeredCrop(width, height, COVER_RATIO);
  let crop = whole;
  if (frame) {
    const inFrame = rect(
      Math.max(frame.left, 0),
      Math.max(frame.top, 0),
      Math.min(frame.right, width),
      Math.min(frame.bottom, height),
    );
    if (widthOf(inFrame) >= 20 && heightOf(inFrame) >= 20) crop = ratioInside(inFrame, COVER_RATIO);
  }
  return { imageWidth: width, imageHeight: height, crop, quarterTurns: 0, angleDeg: 0, ratioLocked: true };
}

/** Straightens the picture to `angleDeg`, shrinking the crop as needed. */
export function straighten(state: CoverEditState, angleDeg: number): CoverEditState {
  const [w, h] = workSizeOf(state);
  return { ...state, angleDeg, crop: fitAfterRotation(state.crop, w, h, angleDeg) };
}

/**
 * Turns the picture a quarter clockwise, keeping the straightening. A 2:3 crop starts again centred (the
 * turned one would be 3:2); a free crop turns with the picture.
 */
export function rotateQuarter(state: CoverEditState): CoverEditState {
  const turns = mod4(state.quarterTurns + 1);
  const [w, h] = workSize(state.imageWidth, state.imageHeight, turns);
  const c = state.crop;
  // (x, y) in the old work image goes to (oldHeight - y, x); the old height is the new width.
  const crop = state.ratioLocked
    ? centeredCrop(w, h, COVER_RATIO)
    : rect(w - c.bottom, c.left, w - c.top, c.right);
  return { ...state, quarterTurns: turns, crop: fitAfterRotation(crop, w, h, state.angleDeg) };
}

/** Locks the crop to 2:3 (the largest 2:3 inside the current crop) or frees it. */
export const setRatioLocked = (state: CoverEditState, locked: boolean): CoverEditState => ({
  ...state,
  ratioLocked: locked,
  crop: locked ? ratioInside(state.crop, COVER_RATIO) : state.crop,
});

/** Source pixels → the straightened work image (the space `crop` lives in). */
export function sourceToWork(state: CoverEditState): Affine {
  let w = state.imageWidth;
  let h = state.imageHeight;
  let m = IDENTITY;
  for (let i = 0; i < mod4(state.quarterTurns); i++) {
    // A quarter turn clockwise: (x, y) → (h - y, x), and the sides swap.
    m = compose(m, affine(0, -1, h, 1, 0, 0));
    [w, h] = [h, w];
  }
  return compose(m, rotate(state.angleDeg, w / 2, h / 2));
}

/** Where a crop ends up: source pixels → output pixels, and the output size. */
export type CropOutput = { transform: Affine; width: number; height: number };

/**
 * Source pixels → output pixels of the cropped cover, whose longer side is at most `maxSide`. With an
 * `inset` (work-image pixels), the output keeps its size but shows the crop shrunk by that much on each
 * side, so filtering never reaches past the picture's edge.
 */
export function outputTransform(state: CoverEditState, maxSide: number, inset = 0): CropOutput {
  const crop = state.crop;
  const cw = widthOf(crop);
  const ch = heightOf(crop);
  const scale = Math.min(1, maxSide / Math.max(cw, ch));
  const width = Math.max(1, Math.round(cw * scale));
  const height = Math.max(1, Math.round(ch * scale));
  const i = Math.min(Math.max(inset, 0), Math.min(cw, ch) / 4);
  const shown = affine(width / (cw - 2 * i), 0, 0, 0, height / (ch - 2 * i), 0);
  return {
    transform: compose(compose(sourceToWork(state), translate(-crop.left - i, -crop.top - i)), shown),
    width,
    height,
  };
}
