import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ReviewKeyBar } from './ReviewKeyBar.jsx';

const show = (props) => render(<MantineProvider><ReviewKeyBar tally={{ done: 38, total: 52, redo: 3 }} {...props} /></MantineProvider>);
const keys = () => [...document.querySelectorAll('[data-key]')].map((n) => n.getAttribute('data-key'));

describe('ReviewKeyBar', () => {
  it('shows the verdict tally', () => { show({ row: null }); expect(screen.getByText('38/52 · 3 redo')).toBeTruthy(); });
  it('omits the redo count when none', () => { show({ row: null, tally: { done: 2, total: 5, redo: 0 } }); expect(screen.getByText('2/5')).toBeTruthy(); });
  it("shows only the current kind's action keys", () => {
    show({ row: { kind: 'words' } });
    expect(keys()).toEqual(expect.arrayContaining(['M', 'P', 'W', 'A', 'R', 'I', 'D']));
    expect(keys()).not.toContain('B'); expect(keys()).not.toContain('K');
  });
  it('picture rows get B and K but not M or P', () => {
    show({ row: { kind: 'picture' } });
    expect(keys()).toEqual(expect.arrayContaining(['B', 'K', 'W'])); expect(keys()).not.toContain('M'); expect(keys()).not.toContain('P');
  });
  it('undo shows only while it can', () => {
    const { unmount } = show({ row: { kind: 'words' }, canUndo: false }); expect(keys()).not.toContain('U'); unmount();
    show({ row: { kind: 'words' }, canUndo: true }); expect(keys()).toContain('U');
  });
  it('shows the redo reasons while the picker is open, and the status message', () => {
    show({ row: { kind: 'words' }, redoOpen: true, message: 'All 4 in this view reviewed' });
    expect(keys()).toEqual(expect.arrayContaining(['1', '2', '3', '4', 'Enter']));
    expect(screen.getByRole('status').textContent).toContain('All 4 in this view reviewed');
  });
  it('? opens the full keymap overlay', () => {
    show({ row: { kind: 'words' }, helpOpen: true });
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText(/Replay/)).toBeTruthy(); expect(within(dlg).getByText(/Widen/)).toBeTruthy();
  });
});
