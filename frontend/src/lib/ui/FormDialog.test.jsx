import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { DismissStackProvider } from './dismiss/DismissStackProvider.jsx';
import { FormDialog } from './FormDialog.jsx';

function renderDialogs(ui) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('FormDialog', () => {
  it('closes the nested form first, then the editor, on successive Escape presses', async () => {
    function NestedForms() {
      const [editorOpen, setEditorOpen] = useState(true);
      const [imageOpen, setImageOpen] = useState(false);
      return (
        <FormDialog opened={editorOpen} onClose={() => setEditorOpen(false)} title="Edit Item">
          <button onClick={() => setImageOpen(true)}>Set Image</button>
          <FormDialog opened={imageOpen} onClose={() => setImageOpen(false)} title="Item Image">
            <p>Choose an image</p>
          </FormDialog>
        </FormDialog>
      );
    }

    renderDialogs(<DismissStackProvider><NestedForms /></DismissStackProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Set Image' }));
    await screen.findByText('Choose an image');

    fireEvent.keyDown(screen.getByText('Choose an image'), { key: 'Escape' });
    await waitFor(() => expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1));
    expect(screen.getByText('Edit Item')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByText('Edit Item'), { key: 'Escape' });
    await waitFor(() => expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0));
  });

  it('keeps Mantine Escape dismissal when no shared stack is mounted', async () => {
    const onClose = vi.fn();
    renderDialogs(<FormDialog opened onClose={onClose} title="Standalone form">body</FormDialog>);

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Standalone form' }), { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps Escape inside a managed nested form while dismissal is disabled', async () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    function NestedBusyForm() {
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <FormDialog opened onClose={outerClose} title="Editor">
          <button onClick={() => setInnerOpen(true)}>Open saving form</button>
          <FormDialog opened={innerOpen} onClose={innerClose} closeOnEscape={false} title="Saving form">
            <p>Save in progress</p>
          </FormDialog>
        </FormDialog>
      );
    }

    renderDialogs(<DismissStackProvider><NestedBusyForm /></DismissStackProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open saving form' }));
    await screen.findByText('Save in progress');
    fireEvent.keyDown(screen.getByText('Save in progress'), { key: 'Escape' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(innerClose).not.toHaveBeenCalled();
    expect(outerClose).not.toHaveBeenCalled();
    expect(screen.getByText('Save in progress')).toBeInTheDocument();
  });
});
