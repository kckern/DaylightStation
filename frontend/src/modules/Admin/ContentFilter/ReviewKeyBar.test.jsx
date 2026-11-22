import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ReviewKeyBar } from './ReviewKeyBar.jsx';

// Under the part card: the redo prompt, the station's message and the keymap sheet. The everyday
// keys sit on the part card's own buttons (RowEditor), so this strip shows no legend of its own.
const show = (props) => render(<MantineProvider><ReviewKeyBar {...props} /></MantineProvider>);
const keys = () => [...document.querySelectorAll('[data-key]')].map((n) => n.getAttribute('data-key'));

describe('ReviewKeyBar', () => {
  it('shows no key legend outside the redo prompt', () => {
    show({});
    expect(keys()).toEqual([]);
  });
  it('shows the redo reasons while the picker is open, and the status message', () => {
    show({ redoOpen: true, message: 'All 4 in this view reviewed' });
    expect(keys()).toEqual(expect.arrayContaining(['1', '2', '3', '4', 'Enter', 'Esc']));
    expect(screen.getByRole('status').textContent).toContain('All 4 in this view reviewed');
  });
  it('? opens the full keymap: Space plays and pauses, X lets a part play, R refines', () => {
    show({ helpOpen: true });
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText('Play / pause the film')).toBeTruthy();
    expect(within(dlg).getByText(/Let it play/)).toBeTruthy();
    expect(within(dlg).getByText(/Refine this part/)).toBeTruthy();
    expect(within(dlg).getByText(/Refine every filtered part/)).toBeTruthy();
    expect(within(dlg).queryByText(/Widen/)).toBeNull();
  });
  it('offers a preview retry', () => {
    let tried = 0;
    show({ previewRecovery: { message: 'The preview could not refresh.', retry: () => { tried++; }, retrying: false } });
    screen.getByRole('button', { name: /Retry preview/ }).click();
    expect(tried).toBe(1);
  });
});
