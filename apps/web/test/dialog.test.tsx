import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, DialogCancel, Modal, SidePanel } from '../src/components/dialog';
import { useToast } from '../src/components/snackbar';
import { axeViolations, renderUi } from './render';

function Harness({ dirty = false, onClose = vi.fn() }: { dirty?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  // The parent owns the field: every keystroke re-renders it and gives the dialog a new onClose.
  const [notes, setNotes] = useState('');
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Modal
          title="Edit wish"
          dirty={dirty}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          footer={<DialogCancel>Cancel</DialogCancel>}
        >
          <label>
            Title
            <input />
          </label>
          <label>
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </Modal>
      )}
    </>
  );
}

describe('Modal', () => {
  it('opens as a modal dialog named by its title, with the focus on the first field', async () => {
    const user = userEvent.setup();
    renderUi(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit wish' });
    expect(dialog).toHaveProperty('open', true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('Title'));
  });

  it('does not take the focus back to the first field when its parent re-renders', async () => {
    const user = userEvent.setup();
    renderUi(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByLabelText('Notes'));
    await user.keyboard('abc');
    expect(screen.getByLabelText<HTMLInputElement>('Notes').value).toBe('abc');
    expect(document.activeElement).toBe(screen.getByLabelText('Notes'));
  });

  it('closes with Escape and gives the focus back to the opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes with the ✕ button and with a click on the backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<Harness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Open' }));
    // A click on ::backdrop reaches the <dialog> itself.
    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('asks before discarding unsaved changes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<Harness dirty onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    const ask = screen.getByRole('alertdialog', { name: 'Discard changes?' });
    expect(ask.textContent).toContain('What you changed in this form will be lost.');
    // The safe answer has the focus.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }));
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Edit wish' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks from the Cancel button too when there are unsaved changes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<Harness dirty onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from the Cancel button at once without changes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<Harness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open under StrictMode, whose second effect run follows a close event', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(
      <StrictMode>
        <Harness onClose={onClose} />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    // The close event of the first run's cleanup arrives a task later.
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByRole('dialog', { name: 'Edit wish' })).toHaveProperty('open', true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets a message sent while it closes be announced once the live region is in place', async () => {
    function SaveAndClose() {
      const [open, setOpen] = useState(true);
      const toast = useToast();
      return open ? (
        <Modal title="Edit wish" onClose={() => setOpen(false)}>
          <button
            onClick={() => {
              toast('Saved');
              setOpen(false);
            }}
          >
            Save
          </button>
        </Modal>
      ) : null;
    }
    renderUi(<SaveAndClose />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // The snackbar moved from the dialog to the page: its region is there, still empty…
    const region = document.querySelector('body > .snackbar-host [role=status]');
    expect(region?.textContent).toBe('');
    // …and the message arrives a frame later, as a change the screen reader announces.
    await waitFor(() => expect(region?.textContent).toContain('Saved'));
  });

  it('closes the confirmation, not the form, on Escape inside it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<Harness dirty onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Edit wish' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const user = userEvent.setup();
    renderUi(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('ConfirmDialog', () => {
  it('is an alert dialog described by its text, with a destructive confirming button', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderUi(
      <ConfirmDialog
        title="Delete this edition?"
        text="It goes for good."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this edition?' });
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe(
      'It goes for good.',
    );
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm.className).toContain('destructive');
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('SidePanel', () => {
  function Panel({ onClose, initiallyOpen = false }: { onClose: () => void; initiallyOpen?: boolean }) {
    // `open` stands in for the URL (?book=…), the panel's source of truth.
    const [open, setOpen] = useState(initiallyOpen);
    return (
      <>
        <button onClick={() => setOpen(true)}>Dune</button>
        <SidePanel
          open={open}
          label="Book details"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <button>Edit details</button>
        </SidePanel>
      </>
    );
  }

  it('stays open under StrictMode when it mounts open (a shared ?book= link)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Page() {
      const [shown, setShown] = useState(false);
      return shown ? (
        <Panel onClose={onClose} initiallyOpen />
      ) : (
        <button onClick={() => setShown(true)}>Show page</button>
      );
    }
    renderUi(
      <StrictMode>
        <Page />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: 'Show page' }));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByRole('dialog', { name: 'Book details' })).toHaveProperty('open', true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opens as a modal dialog with the focus in it and gives it back on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<Panel onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const opener = screen.getByRole('button', { name: 'Dune' });
    await user.click(opener);
    const panel = screen.getByRole('dialog', { name: 'Book details' });
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(panel);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
