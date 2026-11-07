import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeImage, EDIT_MAX_SIDE, fitSide, PREVIEW_MAX_SIDE } from '../src/lib/image';

describe('picture sizes', () => {
  it('reduces to the longest side and never enlarges', () => {
    expect(fitSide(6000, 8000, EDIT_MAX_SIDE)).toEqual({ width: 2400, height: 3200 });
    expect(fitSide(4000, 3000, PREVIEW_MAX_SIDE)).toEqual({ width: 1440, height: 1080 });
    expect(fitSide(800, 1200, EDIT_MAX_SIDE)).toEqual({ width: 800, height: 1200 });
  });
});

describe('decodeImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the photo upright, works at 3200 px, previews at 1440 px and frees every bitmap', async () => {
    const closed: string[] = [];
    const bitmap = (name: string, width: number, height: number) =>
      ({ name, width, height, close: () => closed.push(name) }) as unknown as ImageBitmap;
    const calls: unknown[] = [];
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async (src: unknown, opts: ImageBitmapOptions) => {
        calls.push(opts);
        if (src instanceof Blob) return bitmap('upright', 6000, 8000);
        return bitmap(opts.resizeHeight === 3200 ? 'edit' : 'preview', opts.resizeWidth!, opts.resizeHeight!);
      }),
    );
    const p = await decodeImage(new Blob(['x']));
    expect(calls[0]).toEqual({ imageOrientation: 'from-image' });
    expect([p.width, p.height]).toEqual([2400, 3200]);
    expect((p.preview as ImageBitmap).height).toBe(1440);
    // The full-size decode is not kept.
    expect(closed).toEqual(['upright']);
    p.close?.();
    expect(closed).toEqual(['upright', 'edit', 'preview']);
  });
});
