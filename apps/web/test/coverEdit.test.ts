/** The same cases as the Android app's CoverEditTest, on the TypeScript port of the geometry. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  affine,
  centeredCrop,
  COVER_RATIO,
  CROP_HANDLES,
  cropFits,
  fitAfterRotation,
  heightOf,
  hitTest,
  initialEditState,
  mapPoint,
  moveCrop,
  outputTransform,
  rect,
  resizeCrop,
  rotateQuarter,
  setRatioLocked,
  sourceToWork,
  straighten,
  widthOf,
  workSizeOf,
  type Rect,
} from '../src/lib/coverEdit';

/** A small seeded generator (mulberry32), so the random cases are the same on every run. */
function random(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo)),
    bool: () => next() < 0.5,
  };
}

const expectRect = (expected: Rect, actual: Rect, delta = 0.01) => {
  for (const k of ['left', 'top', 'right', 'bottom'] as const)
    expect(Math.abs(actual[k] - expected[k]), `${k}: ${JSON.stringify(actual)}`).toBeLessThanOrEqual(delta);
};
const expectPoint = (x: number, y: number, actual: [number, number]) => {
  expect(actual[0]).toBeCloseTo(x, 2);
  expect(actual[1]).toBeCloseTo(y, 2);
};
const ratioOf = (r: Rect) => widthOf(r) / heightOf(r);

describe('cover crop geometry', () => {
  it('starts with the largest centred cover on portrait and landscape pictures', () => {
    expectRect(rect(0, 250, 1000, 1750), centeredCrop(1000, 2000, COVER_RATIO));
    expectRect(rect(1000, 0, 2000, 1500), centeredCrop(3000, 1500, COVER_RATIO));
  });

  it('takes a frame as the initial crop and keeps it inside the picture', () => {
    const s = initialEditState(3000, 4000, rect(900, 1000, 2100, 2800));
    expectRect(rect(900, 1000, 2100, 2800), s.crop);
    expect(s.ratioLocked).toBe(true);
    const clipped = initialEditState(1000, 1000, rect(-100, -100, 500, 800)).crop;
    expect(ratioOf(clipped)).toBeCloseTo(COVER_RATIO, 3);
    expect(cropFits(clipped, 1000, 1000, 0)).toBe(true);
    expectRect(centeredCrop(1000, 2000, COVER_RATIO), initialEditState(1000, 2000).crop);
  });

  it('fits the whole picture straight but not tilted by 30 degrees', () => {
    const whole = rect(0, 0, 1000, 1500);
    expect(cropFits(whole, 1000, 1500, 0)).toBe(true);
    expect(cropFits(whole, 1000, 1500, 30)).toBe(false);
    expect(cropFits(rect(-1, 0, 10, 10), 1000, 1500, 0)).toBe(false);
  });

  it('always fits a crop after straightening, keeping its proportion', () => {
    const r = random(7);
    for (let i = 0; i < 200; i++) {
      const w = r.int(200, 4000);
      const h = r.int(200, 4000);
      const angle = r.next() * 90 - 45;
      const start = moveCrop(
        centeredCrop(w, h, r.bool() ? COVER_RATIO : r.next() + 0.3),
        r.next() * w - w / 2,
        r.next() * h - h / 2,
        w,
        h,
        0,
      );
      const fitted = fitAfterRotation(start, w, h, angle);
      expect(cropFits(fitted, w, h, angle), `${JSON.stringify(start)} at ${angle}° in ${w}x${h}`).toBe(true);
      expect(Math.abs(ratioOf(start) - ratioOf(fitted))).toBeLessThan(0.01);
      expect(widthOf(fitted)).toBeGreaterThan(0);
    }
  });

  it('leaves alone a crop that already fits', () => {
    const small = rect(400, 600, 600, 900);
    expect(fitAfterRotation(small, 1000, 1500, 20)).toEqual(small);
  });

  it('never moves or resizes out of the picture nor below the minimum', () => {
    const r = random(11);
    for (let i = 0; i < 300; i++) {
      const w = r.int(300, 3000);
      const h = r.int(300, 3000);
      const angle = r.next() * 90 - 45;
      const locked = r.bool();
      const minSize = 50;
      let crop = fitAfterRotation(centeredCrop(w, h, COVER_RATIO), w, h, angle);
      if (widthOf(crop) < minSize * 2) continue;
      for (let j = 0; j < 10; j++) {
        const handle = CROP_HANDLES[r.int(0, CROP_HANDLES.length)]!;
        const dx = (r.next() - 0.5) * w * 2;
        const dy = (r.next() - 0.5) * h * 2;
        const next = resizeCrop(crop, handle, dx, dy, locked ? COVER_RATIO : null, minSize, w, h, angle);
        expect(cropFits(next, w, h, angle), `${handle} by (${dx}, ${dy})`).toBe(true);
        expect(widthOf(next)).toBeGreaterThanOrEqual(minSize - 0.01);
        expect(heightOf(next)).toBeGreaterThanOrEqual(minSize - 0.01);
        if (locked) expect(Math.abs(ratioOf(next) - COVER_RATIO)).toBeLessThan(0.001);
        crop = next;
      }
    }
  });

  it('slides along the edge a move meets', () => {
    expectRect(rect(0, 150, 200, 450), moveCrop(rect(100, 100, 300, 400), -500, 50, 1000, 1500, 0), 0.05);
  });

  it('keeps the cover proportion on every handle when locked', () => {
    const crop = rect(300, 300, 500, 600);
    for (const handle of CROP_HANDLES)
      for (const [dx, dy] of [
        [30, 10],
        [-30, -10],
        [5, -40],
      ] as const) {
        const r = resizeCrop(crop, handle, dx, dy, COVER_RATIO, 20, 1000, 1500, 0);
        expect(Math.abs(ratioOf(r) - COVER_RATIO), handle).toBeLessThan(0.0001);
      }
    const r = resizeCrop(crop, 'topLeft', -3, -2, COVER_RATIO, 20, 1000, 1500, 0);
    expect(r.right).toBeCloseTo(500, 3);
    expect(r.bottom).toBeCloseTo(600, 3);
    expect(widthOf(r) - widthOf(crop)).toBeGreaterThanOrEqual(0);
    expect(widthOf(r) - widthOf(crop)).toBeLessThanOrEqual(4);
  });

  it('moves only its side with a free edge', () => {
    const crop = rect(300, 300, 500, 600);
    expectRect(rect(250, 300, 500, 600), resizeCrop(crop, 'left', -50, 99, null, 20, 1000, 1500, 0));
    expectRect(rect(300, 300, 500, 320), resizeCrop(crop, 'bottom', 0, -1000, null, 20, 1000, 1500, 0));
  });

  it('grabs corners, edges or the whole crop', () => {
    const crop = rect(100, 100, 300, 400);
    expect(hitTest(crop, 105, 95, 20)).toBe('topLeft');
    expect(hitTest(crop, 310, 410, 20)).toBe('bottomRight');
    expect(hitTest(crop, 290, 250, 20)).toBe('right');
    expect(hitTest(crop, 200, 110, 20)).toBe('top');
    expect(hitTest(crop, 200, 250, 20)).toBe('move');
    expect(hitTest(crop, 500, 250, 20)).toBeNull();
  });

  it('comes back after four quarter turns', () => {
    const start = { ...setRatioLocked(initialEditState(1200, 900), false), crop: rect(100, 50, 700, 800) };
    let s = start;
    for (let i = 0; i < 4; i++) s = rotateQuarter(s);
    expect(s.quarterTurns).toBe(0);
    expectRect(start.crop, s.crop);
    expectPoint(123, 456, mapPoint(sourceToWork(s), 123, 456));
  });

  it('restarts a locked crop on a quarter turn and turns a free one', () => {
    const locked = rotateQuarter(initialEditState(1200, 900));
    expect(workSizeOf(locked)).toEqual([900, 1200]);
    expectRect(centeredCrop(900, 1200, COVER_RATIO), locked.crop);
    const free = { ...setRatioLocked(initialEditState(1200, 900), false), crop: rect(0, 0, 100, 200) };
    expectRect(rect(700, 0, 900, 100), rotateQuarter(free).crop);
  });

  it('keeps the crop inside when straightening', () => {
    const s = straighten(initialEditState(1000, 1500), 30);
    expect(s.angleDeg).toBe(30);
    expect(cropFits(s.crop, 1000, 1500, 30)).toBe(true);
    expect(ratioOf(s.crop)).toBeCloseTo(COVER_RATIO, 3);
  });

  it('takes the largest cover inside the crop when locking the ratio', () => {
    const free = { ...setRatioLocked(initialEditState(1000, 1000), false), crop: rect(0, 0, 900, 300) };
    expectRect(rect(350, 0, 550, 300), setRatioLocked(free, true).crop);
  });

  it('outputs a straight crop as a pure translation', () => {
    const s = { ...initialEditState(1000, 1500), crop: rect(100, 200, 500, 800) };
    const out = outputTransform(s, 1600);
    expect([out.width, out.height]).toEqual([400, 600]);
    expect(out.transform).toEqual(affine(1, 0, -100, 0, 1, -200));
  });

  it('keeps the output size and shows the crop shrunk with an inset', () => {
    const s = { ...initialEditState(1000, 1500), crop: rect(100, 200, 500, 800) };
    const out = outputTransform(s, 1600, 1);
    expect([out.width, out.height]).toEqual([400, 600]);
    expectPoint(0, 0, mapPoint(out.transform, 101, 201));
    expectPoint(400, 600, mapPoint(out.transform, 499, 799));
  });

  it('scales the output down to the maximum side', () => {
    const out = outputTransform(initialEditState(2000, 3000), 1500);
    expect([out.width, out.height]).toEqual([1000, 1500]);
    expectPoint(1000, 1500, mapPoint(out.transform, 2000, 3000));
  });

  it('maps the source corners onto the output after quarter turns', () => {
    const quarter = {
      ...rotateQuarter(setRatioLocked(initialEditState(400, 200), false)),
      crop: rect(0, 0, 200, 400),
    };
    const q = outputTransform(quarter, 1600);
    expect([q.width, q.height]).toEqual([200, 400]);
    expectPoint(200, 0, mapPoint(q.transform, 0, 0));
    expectPoint(200, 400, mapPoint(q.transform, 400, 0));
    expectPoint(0, 0, mapPoint(q.transform, 0, 200));
    const half = { ...rotateQuarter(quarter), crop: rect(0, 0, 400, 200) };
    const hT = outputTransform(half, 1600).transform;
    expectPoint(400, 200, mapPoint(hT, 0, 0));
    expectPoint(0, 0, mapPoint(hT, 400, 200));
  });
});
