import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DismissStackProvider } from './dismiss/DismissStackProvider.jsx';
import { ConfirmModal } from './ConfirmModal.jsx';

function renderConfirm(ui) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('ConfirmModal', () => {
  it('renders extra decision content, custom cancel text, and a disabled confirmation', () => {
    renderConfirm(
      <ConfirmModal
        opened
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Retire screen?"
        message="This screen will leave the fleet."
        cancelLabel="Keep screen"
        confirmLabel="Retire"
        confirmDisabled
      >
        <p>Two routines use this screen.</p>
      </ConfirmModal>,
    );

    expect(screen.getByText('This screen will leave the fleet.')).toBeInTheDocument();
    expect(screen.getByText('Two routines use this screen.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep screen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retire' })).toBeDisabled();
  });

  it('lets the shared dismiss stack own Escape when a modal is open', async () => {
    const onClose = vi.fn();
    renderConfirm(
      <DismissStackProvider>
        <ConfirmModal opened onClose={onClose} onConfirm={vi.fn()} title="Confirm reset" message="Reset?" />
      </DismissStackProvider>,
    );

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Confirm reset' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
