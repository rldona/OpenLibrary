/** Decoding a picture and rendering a cover crop of it, with the browser's own canvas. */
import {
  heightOf,
  outputTransform,
  sourceToWork,
  widthOf,
  type Affine,
  type CoverEditState,
} from './coverEdit';

/** Longest side of a cropped cover and its JPEG quality (the server keeps covers up to 1600 px). */
export const COVER_MAX_SIDE = 1600;
export const COVER_QUALITY = 0.85;

/** The editor works on the picture reduced to this longest side (Android's EDIT_MAX_SIDE). */
export const EDIT_MAX_SIDE = 3200;
/** The copy drawn on screen while editing: enough for a large display, light to redraw. */
export const PREVIEW_MAX_SIDE = 1440;

/**
 * A picture ready to edit. `width` x `height` is the space the crop geometry lives in; `source` has that
 * size (the cover is rendered from it) and `preview` is a smaller copy of it for the screen.
 */
export type Picture = {
  width: number;
  height: number;
  source: CanvasImageSource;
  preview: CanvasImageSource;
  close?: () => void;
};

/** `width` x `height` reduced (never enlarged) so its longest side is at most `max`. */
export function fitSide(width: number, height: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

async function resized(bitmap: ImageBitmap, max: number): Promise<ImageBitmap> {
  const size = fitSide(bitmap.width, bitmap.height, max);
  if (size.width === bitmap.width && size.height === bitmap.height) return bitmap;
  return createImageBitmap(bitmap, {
    resizeWidth: size.width,
    resizeHeight: size.height,
    resizeQuality: 'high',
  });
}

/**
 * The picture upright (its EXIF orientation applied) and reduced to EDIT_MAX_SIDE, plus a screen copy.
 * A phone photo of 48 MP would otherwise be kept and redrawn whole. `close()` frees both bitmaps.
 */
export async function decodeImage(file: Blob): Promise<Picture> {
  const upright = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const edit = await resized(upright, EDIT_MAX_SIDE);
  if (edit !== upright) upright.close();
  const preview = await resized(edit, PREVIEW_MAX_SIDE);
  return {
    width: edit.width,
    height: edit.height,
    source: edit,
    preview,
    close: () => {
      edit.close();
      if (preview !== edit) preview.close();
    },
  };
}

/** Sets a canvas transform from ours (x' = a·x + b·y + c, y' = d·x + e·y + f), scaled by `k`. */
export const setTransform = (ctx: CanvasRenderingContext2D, m: Affine, k = 1) =>
  ctx.setTransform(m.a * k, m.d * k, m.b * k, m.e * k, m.c * k, m.f * k);

/** Draws the turned and straightened picture (the editor's work image) at `scale`. */
export function drawWork(
  ctx: CanvasRenderingContext2D,
  picture: Picture,
  state: CoverEditState,
  scale: number,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.imageSmoothingQuality = 'high';
  setTransform(ctx, sourceToWork(state), scale);
  // The screen copy, stretched over the picture's own size (the space the transform expects).
  ctx.drawImage(picture.preview, 0, 0, picture.width, picture.height);
}

/** The crop as a JPEG: the longest side at most COVER_MAX_SIDE, on white (JPEG has no transparency). */
export function renderCrop(picture: Picture, state: CoverEditState): Promise<Blob> {
  // Half an output pixel (at least one picture pixel) in from the crop's edge, so smoothing never
  // reaches past the picture.
  const scale = Math.min(1, COVER_MAX_SIDE / Math.max(widthOf(state.crop), heightOf(state.crop)));
  const out = outputTransform(state, COVER_MAX_SIDE, Math.max(1, 0.5 / scale));
  const canvas = document.createElement('canvas');
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('no canvas'));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  setTransform(ctx, out.transform);
  ctx.drawImage(picture.source, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/jpeg', COVER_QUALITY),
  );
}
