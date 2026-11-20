import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { PairedList } from './PairedList.jsx';
import { NearbyList } from './NearbyList.jsx';

const ROW = { address: 'AA:BB:CC:11:22:33', name: 'R1', typeLabel: 'Keyboard', tail: '…22:33', status: 'connected', statusText: 'Connected · 80%', bonded: true, kind: 'keyboard' };

describe('PairedList', () => {
  afterEach(() => vi.useRealTimers());
  const props = (over = {}) => ({ rows: [ROW], busy: false, onForget: vi.fn(), onArm: vi.fn(), onTest: vi.fn(), onPairAgain: vi.fn(), ...over });

  it('Forget takes two presses; the second within 4 s forgets', () => {
    const p = props();
    render(<PairedList {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget R1' }));
    expect(p.onForget).not.toHaveBeenCalled();
    expect(p.onArm).toHaveBeenCalledWith(ROW);
    fireEvent.click(screen.getByRole('button', { name: 'Press again to forget R1' }));
    expect(p.onForget).toHaveBeenCalledWith(ROW);
  });

  it('an armed Forget goes back to Forget after 4 s', () => {
    vi.useFakeTimers();
    render(<PairedList {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget R1' }));
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByRole('button', { name: 'Forget R1' })).toBeTruthy();
  });

  it('Test only when connected; Pair again for a dropped bond; busy disables', () => {
    const p = props({ rows: [ROW, { ...ROW, address: 'X', name: 'Pad', status: 'needs-pairing', statusText: 'Needs pairing again', bonded: false }], busy: true });
    render(<PairedList {...p} />);
    expect(screen.getByRole('button', { name: 'Test R1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Test Pad' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forget Pad' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pair Pad again' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Forget R1' }).disabled).toBe(true);
  });

  it('shows one status, the type and the address tail', () => {
    render(<PairedList {...props()} />);
    const li = document.querySelector('[data-address="AA:BB:CC:11:22:33"]');
    expect(li.textContent).toContain('Connected · 80%');
    expect(li.textContent).toContain('Keyboard');
    expect(li.textContent).toContain('…22:33');
  });

  it('empty', () => {
    render(<PairedList {...props({ rows: [] })} />);
    expect(screen.getByText('No Bluetooth devices paired yet.')).toBeTruthy();
  });
});

describe('NearbyList', () => {
  const NEAR = { address: 'AA:BB:CC:11:22:33', name: 'R1', typeLabel: 'Keyboard', tail: '…22:33', bars: 3, paired: true, highlight: true };
  it('pick, signal, Paired badge, highlight', () => {
    const onPick = vi.fn();
    render(<NearbyList rows={[NEAR]} hidden={2} showAll={false} onToggleShowAll={vi.fn()} onPick={onPick} busy={false} />);
    const pick = screen.getByRole('button', { name: 'Pair R1' });
    expect(pick.textContent).toContain('Paired');
    expect(pick.closest('li').className).toContain('bts-highlight');
    expect(screen.getByLabelText('Signal 3 of 4')).toBeTruthy();
    fireEvent.click(pick);
    expect(onPick).toHaveBeenCalledWith(NEAR);
  });
  it('the toggle says how many are hidden, and flips', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<NearbyList rows={[]} hidden={2} showAll={false} onToggleShowAll={onToggle} onPick={vi.fn()} busy={false} />);
    expect(screen.getByText('Nothing found yet. Put the device in pairing mode and keep it close.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show everything (2 more)' }));
    expect(onToggle).toHaveBeenCalled();
    rerender(<NearbyList rows={[]} hidden={0} showAll onToggleShowAll={onToggle} onPick={vi.fn()} busy={false} />);
    expect(screen.getByRole('button', { name: 'Show input devices only' }).getAttribute('aria-pressed')).toBe('true');
  });
});
