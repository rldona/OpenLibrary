/**
 * jsdom has <dialog> but not showModal()/close(), nor Escape cancelling the topmost modal dialog.
 * This is the smallest stand-in the dialog components need; focus trapping and inertness are the
 * browser's and are not emulated.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

const modals: HTMLDialogElement[] = [];
const proto = typeof HTMLDialogElement === 'undefined' ? null : HTMLDialogElement.prototype;
if (proto && !proto.showModal) {
  proto.showModal = function (this: HTMLDialogElement) {
    if (this.hasAttribute('open')) throw new DOMException('Already open', 'InvalidStateError');
    this.setAttribute('open', '');
    modals.push(this);
  };
  proto.show = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement, returnValue?: string) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    if (returnValue !== undefined) this.returnValue = returnValue;
    const i = modals.lastIndexOf(this);
    if (i >= 0) modals.splice(i, 1);
    // Browsers fire `close` a task later, not during close().
    setTimeout(() => this.dispatchEvent(new Event('close')));
  };
  document.addEventListener('keydown', (e) => {
    const top = modals.at(-1);
    if (e.key !== 'Escape' || !top) return;
    const cancel = new Event('cancel', { cancelable: true });
    if (top.dispatchEvent(cancel)) top.close();
  });
}
