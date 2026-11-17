import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RewardsModal from './RewardsModal.jsx';
import { SchoolSurfaceProvider } from '../portal/SchoolSurface.jsx';
import { useSchoolCommands } from '../portal/useSchoolCommands.js';
import { schoolApi } from '../schoolApi.js';

vi.mock('../schoolApi.js', () => { const endpoints = { schoolApi: { earningsRoster: vi.fn(), wallet: vi.fn(), gems: vi.fn(), stateGates: vi.fn() } }; return { ...endpoints, createSchoolApi: () => ({ ...endpoints.schoolApi }) }; });
const learner = { id: 'one', name: 'Learner One' };
const snapshot = {
  learnerId: 'one', week: '2026-11-09', mode: 'live', silver: 24, gold: 3, rings: 1260,
  groups: [{ id: 'school', label: 'School' }],
  gems: [{ id: 'reading', label: 'Reading', group: 'school', color: '#f2c94c', cell: { state: 'pending', week: 0,
    streak: { have: 3, need: 4, reach: 'on-track' }, parts: [] } }],
};
beforeEach(() => {
  const proto = Object.getPrototypeOf(document.createElement('dialog'));
  vi.spyOn(proto, 'showModal').mockImplementation(function () { this.setAttribute('open', ''); });
  vi.spyOn(proto, 'close').mockImplementation(function () { this.removeAttribute('open'); });
  vi.clearAllMocks();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('prepared personal Gem Board', () => {
  it('contains scoped rewards in the host and blocks background commands until close', () => {
    const action = vi.fn(), close = vi.fn();
    function Background() { useSchoolCommands({ enter: action }); return null; }
    const view = render(<SchoolSurfaceProvider surfaceId="small"><Background /><RewardsModal learner={learner} snapshot={snapshot} onClose={close} idleMs={0} /></SchoolSurfaceProvider>);
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('[data-school-overlay="small"]')).toBeInTheDocument();
    expect(dialog).toHaveAttribute('data-scoped', 'true');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(action).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('renders immediately from memory: no requests, loaders, prose list or progress bars', () => {
    const { container } = render(<RewardsModal learner={learner} snapshot={snapshot} onClose={vi.fn()} />);
    expect(screen.getByText('24')).toBeTruthy(); expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('1,260')).toBeTruthy();
    expect(screen.queryByText(/Loading|collection of your effort/)).toBeNull();
    const modal = screen.getByRole('dialog', { name: "Learner One's rewards" });
    expect(modal.querySelectorAll('.gem-glyph')).toHaveLength(1);
    expect(modal.querySelectorAll('.gem-glyph__seg')).toHaveLength(4);
    expect(modal.querySelectorAll('.gem-glyph__seg.is-done')).toHaveLength(3);
    expect(modal.querySelector('progress')).toBeNull();
    for (const method of Object.values(schoolApi)) expect(method).not.toHaveBeenCalled();
  });

  it('keeps the opening snapshot unchanged when background memory updates', () => {
    const { rerender } = render(<RewardsModal learner={learner} snapshot={snapshot} onClose={vi.fn()} />);
    rerender(<RewardsModal learner={learner} snapshot={{ ...snapshot, silver: 999, gems: [] }} onClose={vi.fn()} />);
    expect(screen.getByText('24')).toBeTruthy(); expect(screen.queryByText('999')).toBeNull();
    expect(document.querySelectorAll('.gem-glyph')).toHaveLength(1);
  });

  it('shows the selected child avatar and only earned or partly earned gems, without empty slots or labels', () => {
    const row = (id, cell) => ({ ...snapshot.gems[0], id, label: id, cell });
    render(<RewardsModal learner={learner} snapshot={{ ...snapshot, gems: [
      ...snapshot.gems,
      row('Earned gem', { state: 'earned', week: 1 }),
      row('Held gem', { state: 'leading', held: 1 }),
      row('Not started', { state: 'none', week: 0 }),
      row('Zero progress', { state: 'pending', week: 0, streak: { have: 0, need: 4, reach: 'on-track' } }),
      row('Unknown gem', { state: 'unknown', week: 0 }),
      row('Disabled gem', { state: 'disabled' }),
    ] }} onClose={vi.fn()} />);
    const modal = screen.getByRole('dialog');
    expect(modal.querySelectorAll('.gem-glyph')).toHaveLength(3);
    for (const name of ['Not started', 'Zero progress', 'Unknown gem', 'Disabled gem']) expect(screen.queryByText(name)).toBeNull();
    const avatar = modal.querySelector('.piano-avatar');
    expect(avatar).toBeTruthy();
    expect(avatar.getAttribute('src')).toContain('/one');
  });

  it('owns Escape and passes the selected child to the existing Bank log', () => {
    const onClose = vi.fn(), onOpenBank = vi.fn(), parent = vi.fn();
    window.addEventListener('keydown', parent);
    try {
      render(<RewardsModal learner={learner} snapshot={snapshot} onClose={onClose} onOpenBank={onOpenBank} />);
      fireEvent.keyDown(screen.getByRole('button', { name: 'Close rewards' }), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1); expect(parent).not.toHaveBeenCalled();
      fireEvent.mouseDown(screen.getByRole('button', { name: 'Bank log' }), { button: 0 });
      expect(onOpenBank).toHaveBeenCalledWith('one');
    } finally { window.removeEventListener('keydown', parent); }
  });

  it('has a stable unavailable state without invented zeroes and closes when idle', async () => {
    vi.useFakeTimers(); const close = vi.fn();
    render(<RewardsModal learner={learner} snapshot={{ ...snapshot, silver: null, gold: null, rings: null, gems: [] }} onClose={close} idleMs={1000} />);
    expect(screen.queryByText('0')).toBeNull(); expect(screen.queryByText(/Loading/)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1000)); expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('rewards close gesture', () => {
  it.each(['mouse', 'touch', 'pen'])('keeps the dialog until the %s press completes and accepts a later Log book click', (type) => {
    function Fixture() {
      const [open, setOpen] = React.useState(true);
      const [books, setBooks] = React.useState(0);
      return <><button onClick={() => setBooks(n => n + 1)}>Log book {books}</button>{open && <RewardsModal learner={learner} snapshot={snapshot} idleMs={0} onClose={() => setOpen(false)} />}</>;
    }
    render(<Fixture />);
    const close = screen.getByRole('button', { name: 'Close rewards' });
    fireEvent.pointerDown(close, { pointerType: type, isPrimary: true, button: 0 });
    if (type === 'mouse') fireEvent.mouseDown(close, { button: 0 });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerUp(close, { pointerType: type, isPrimary: true, button: 0 });
    fireEvent.mouseUp(close, { button: 0 });
    fireEvent.click(close, { detail: 1 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Log book 0' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Log book 0' }));
    expect(screen.getByRole('button', { name: 'Log book 1' })).toBeTruthy();
  });
});
