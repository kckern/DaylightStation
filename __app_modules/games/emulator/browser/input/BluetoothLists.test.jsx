import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DeviceList } from './DeviceList.jsx';
import { DevicePage } from './DevicePage.jsx';
import { NearbyList } from './NearbyList.jsx';

const ROW = { address: 'AA:BB:CC:11:22:33', name: 'R1', detail: 'Keyboard', status: 'connected', statusText: 'Connected', bonded: true, tail: '…22:33' };

describe('DeviceList', () => {
  it('one tall row per device: name, detail, one status; picking selects', () => {
    const onSelect = vi.fn();
    render(<DeviceList rows={[ROW]} selected={ROW.address} onSelect={onSelect} onSearch={vi.fn()} />);
    const r = document.querySelector('.bts-device[data-address="AA:BB:CC:11:22:33"]');
    expect(r.textContent).toBe('R1ConnectedKeyboard');
    expect(r.getAttribute('aria-current')).toBe('true');
    fireEvent.click(r);
    expect(onSelect).toHaveBeenCalledWith(ROW);
  });
  it('empty and checking', () => {
    const { rerender } = render(<DeviceList rows={[]} onSearch={vi.fn()} />);
    expect(screen.getByText('No Bluetooth devices paired yet.')).toBeTruthy();
    rerender(<DeviceList rows={[]} checking onSearch={vi.fn()} />);
    expect(screen.getByText('Checking Bluetooth…')).toBeTruthy();
  });
});

describe('DevicePage', () => {
  it('Forget takes two presses; the second within 4 s forgets; it disarms after 4 s and on blur', () => {
    vi.useFakeTimers();
    try {
      const onForget = vi.fn();
      render(<DevicePage row={ROW} face={null} onForget={onForget} />);
      fireEvent.click(screen.getByRole('button', { name: 'Forget R1' }));
      act(() => { vi.advanceTimersByTime(4100); });
      expect(screen.getByRole('button', { name: 'Forget R1' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Forget R1' }));
      fireEvent.blur(screen.getByRole('button', { name: 'Press again to forget R1' }));
      expect(screen.getByRole('button', { name: 'Forget R1' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Forget R1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Press again to forget R1' }));
      expect(onForget).toHaveBeenCalledWith(ROW);
    } finally { vi.useRealTimers(); }
  });
  it('Pair again for a dropped bond; busy disables; Edit only when allowed', () => {
    const r = { ...ROW, status: 'needs-pairing', statusText: 'Needs pairing again', bonded: false };
    const { rerender } = render(<DevicePage row={r} face={null} busy />);
    expect(screen.getByRole('button', { name: 'Pair R1 again' }).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Forget/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit buttons' })).toBeNull();
    rerender(<DevicePage row={ROW} face={null} canEdit />);
    expect(screen.getByRole('button', { name: 'Edit buttons' })).toBeTruthy();
  });
});

describe('NearbyList', () => {
  const rows = [
    { address: 'A', name: 'Pad', typeLabel: 'Controller', tail: '…00:01', bars: 3, paired: true, highlight: true },
    { address: 'B', name: 'Ring', typeLabel: 'Keyboard', tail: '…00:02', bars: 0, paired: false, highlight: false },
  ];
  it('pick, signal, Paired badge, highlight', () => {
    const onPick = vi.fn();
    render(<NearbyList rows={rows} hidden={0} showAll={false} onToggleShowAll={vi.fn()} onPick={onPick} />);
    const pad = screen.getByRole('button', { name: 'Pair Pad' });
    expect(pad.className).toContain('bts-highlight');
    expect(pad.textContent).toContain('Paired');
    expect(screen.getByRole('img', { name: 'Signal 3 of 4' }).querySelectorAll('.bts-bar.is-on')).toHaveLength(3);
    fireEvent.click(pad);
    expect(onPick).toHaveBeenCalledWith(rows[0]);
  });
  it('the toggle says how many are hidden; after a search rows are marked last heard', () => {
    const { rerender } = render(<NearbyList rows={[]} hidden={2} showAll={false} onToggleShowAll={vi.fn()} onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Show everything (2 more)' })).toBeTruthy();
    expect(screen.getByText('Nothing found yet. Put the device in pairing mode and keep it close.')).toBeTruthy();
    rerender(<NearbyList rows={rows} hidden={0} showAll onToggleShowAll={vi.fn()} onPick={vi.fn()} ended />);
    expect(screen.getByText('Last heard in this search.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show input devices only' })).toBeTruthy();
  });
});
