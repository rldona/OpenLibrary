import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverButton } from '../src/components/coverViewer';
import { clampPan, FITTED, zoomAt } from '../src/lib/zoom';
import { axeViolations, renderUi } from './render';

describe('zoom geometry', () => {
  const base = { width: 400, height: 600 };
  const stage = { width: 400, height: 600 };

  it('keeps the point under the pointer still while zooming', () => {
    const v = zoomAt(FITTED, 2, 100, 0, base, stage);
    expect(v).toEqual({ scale: 2, x: -100, y: 0 });
    // The image point that was under the pointer, (100 - x) / scale from the centre, is still there.
    expect((100 - v.x) / v.scale).toBe(100);
  });

  it('stays within 1x..5x and never leaves an empty edge', () => {
    expect(zoomAt(FITTED, 9, 0, 0, base, stage).scale).toBe(5);
    expect(zoomAt(FITTED, 0.2, 0, 0, base, stage).scale).toBe(1);
    expect(clampPan({ scale: 2, x: 999, y: -999 }, base, stage)).toEqual({ scale: 2, x: 200, y: -300 });
    expect(clampPan({ scale: 1, x: 50, y: 50 }, base, stage)).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

const open = async () => {
  const user = userEvent.setup();
  renderUi(
    <main>
      <button>Before</button>
      <CoverButton src="/api/v1/assets/abc?size=full" title="Dune">
        <span>cover</span>
      </CoverButton>
    </main>,
  );
  const opener = screen.getByRole('button', { name: 'Open the cover' });
  await user.click(opener);
  return { user, opener, dialog: screen.getByRole('dialog', { name: 'Cover of Dune' }) };
};
const shown = () => (document.querySelector('.viewer-stage img') as HTMLImageElement).style.transform;

describe('CoverViewer', () => {
  it('shows the full-size cover in a dialog with the close button focused, and closes with Escape', async () => {
    const { user, opener, dialog } = await open();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect((dialog.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe(
      '/api/v1/assets/abc?size=full',
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('zooms with the buttons, + and −, a double click, and back to the actual size', async () => {
    const { user } = await open();
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    expect(zoomOut.getAttribute('aria-disabled')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(shown()).toContain('scale(2.5)');
    expect(zoomOut.getAttribute('aria-disabled')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Fit to screen' }));
    expect(shown()).toContain('scale(1)');

    const stage = screen.getByRole('group', { name: 'Cover of Dune' });
    stage.focus();
    await user.keyboard('+');
    expect(shown()).toContain('scale(2.5)');
    await user.keyboard('0');
    expect(shown()).toContain('scale(1)');
    fireEvent.doubleClick(stage);
    expect(shown()).toContain('scale(2.5)');
    fireEvent.doubleClick(stage);
    expect(shown()).toContain('scale(1)');
  });

  it('closes when the fitted cover is dragged down on a touch screen', async () => {
    const onClose = vi.fn();
    await open();
    const stage = screen.getByRole('group', { name: 'Cover of Dune' });
    const touch = { pointerId: 1, pointerType: 'touch' };
    fireEvent.pointerDown(stage, { ...touch, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { ...touch, clientX: 100, clientY: 180 });
    expect(shown()).toContain('translate(0px, 80px)');
    fireEvent.pointerMove(stage, { ...touch, clientX: 100, clientY: 260 });
    fireEvent.pointerUp(stage, { ...touch, clientX: 100, clientY: 260 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    await open();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
