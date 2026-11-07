import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverEditor } from '../src/components/coverEditor';
import type { CoverEditState } from '../src/lib/coverEdit';
import { axeViolations, renderUi } from './render';

// jsdom has no image decoding nor canvas: a 1000 x 2000 picture, and the crop's JPEG as a blob.
const rendered: CoverEditState[] = [];
vi.mock('../src/lib/image', () => ({
  decodeImage: vi.fn(async () => ({
    width: 1000,
    height: 2000,
    source: {} as CanvasImageSource,
    preview: {} as CanvasImageSource,
  })),
  drawWork: vi.fn(),
  renderCrop: vi.fn(async (_p: unknown, state: CoverEditState) => {
    rendered.push(state);
    return new Blob(['jpeg'], { type: 'image/jpeg' });
  }),
}));

beforeEach(() => {
  rendered.length = 0;
  // Quietly no 2D context, as a browser without canvas.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

async function open() {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  renderUi(<CoverEditor file={new Blob(['x'])} onDone={onDone} onCancel={onCancel} />);
  const crop = await screen.findByRole('button', { name: 'Crop area' });
  return { onDone, onCancel, crop, user: userEvent.setup() };
}
/** The crop announced to screen readers: "w × h px at x, y". */
const said = () => document.querySelector('[aria-live=polite]')!.textContent;

describe('CoverEditor', () => {
  it('starts with the largest 2:3 crop, centred, and uses it as is', async () => {
    const { onDone, user } = await open();
    expect(said()).toBe('1000 × 1500 px at 0, 250');
    expect(screen.getByRole('radio', { name: '2:3 (cover)' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Use this crop' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const file = onDone.mock.calls[0]![0] as File;
    expect(file.type).toBe('image/jpeg');
    expect(rendered[0]!.crop).toEqual({ left: 0, top: 250, right: 1000, bottom: 1750 });
  });

  it('moves the crop with the arrows and resizes it from its corner, Shift for bigger steps', async () => {
    const { crop, user } = await open();
    crop.focus();
    // 1 % of the longer side (20 px) per press.
    await user.keyboard('{ArrowUp}');
    expect(said()).toBe('1000 × 1500 px at 0, 230');
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(said()).toBe('1000 × 1500 px at 0, 430');
    screen.getByRole('button', { name: 'Crop size' }).focus();
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    // Locked to 2:3: 200 px narrower is 300 px shorter.
    expect(said()).toBe('800 × 1200 px at 0, 430');
  });

  it('turns, straightens and frees the crop', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Rotate 90°' }));
    // Turned, the picture is 2000 x 1000: the largest 2:3 is 667 x 1000.
    expect(said()).toBe('667 × 1000 px at 667, 0');
    await user.click(screen.getByRole('radio', { name: 'Free' }));
    expect(screen.getByRole('radio', { name: 'Free' }).getAttribute('aria-checked')).toBe('true');
    const angle = screen.getByRole('slider', { name: /Straighten/ }) as HTMLInputElement;
    expect(angle.getAttribute('aria-valuetext')).toBe('0°');
    fireEvent.change(angle, { target: { value: '12.5' } });
    expect(angle.getAttribute('aria-valuetext')).toBe('12.5°');
    // Straightened, the crop shrinks to stay inside the picture.
    expect(said()).not.toBe('667 × 1000 px at 667, 0');
    await user.click(screen.getByRole('button', { name: 'Start again' }));
    expect(said()).toBe('1000 × 1500 px at 0, 250');
  });

  it('cancels without a cover and has no axe violations', async () => {
    const { onCancel, onDone, user } = await open();
    expect(await axeViolations(document.body)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
