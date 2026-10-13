import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  let snap = { activeNotes: new Map() };
  const subs = new Set();
  return {
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    get: () => snap,
    press(note, timestamp) { snap = { activeNotes: new Map(snap.activeNotes).set(note, { velocity: 80, timestamp }) }; subs.forEach((f) => f()); },
    reset() { snap = { activeNotes: new Map() }; },
  };
});
const reload = vi.hoisted(() => vi.fn());
const write = vi.hoisted(() => vi.fn(async () => ({ path: 'pianos.p1.timing.clickLeadMs', parsed: {} })));
const config = vi.hoisted(() => ({ current: { timing: { clickLeadMs: null } } }));

vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({ pianoId: 'p1', config: config.current }),
  usePianoRosterOptional: () => ({ reload }),
}));
vi.mock('./PianoMidiContext.jsx', () => ({
  usePianoMidiNotes: () => useSyncExternalStore(store.subscribe, store.get, store.get),
}));
vi.mock('./pianoConfigWrite.js', () => ({ writePianoConfigValue: write }));
vi.mock('./modes/SheetMusic/click.js', () => ({ audioContext: () => null, scheduleBlipAt: () => {} }));

import ClickCalibration from './ClickCalibration.jsx';

const T0 = 1_750_000_000_000;

function tapAlong(anchor, offsets) {
  offsets.forEach((off, i) => {
    act(() => {
      vi.setSystemTime(anchor + i * 1000 + off);
      store.press(60 + (i % 2), anchor + i * 1000 + off);
      vi.advanceTimersByTime(0);
    });
  });
}

describe('ClickCalibration', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(T0); store.reset(); reload.mockClear(); write.mockClear();
    config.current = { timing: { clickLeadMs: null } };
  });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the current lead and its source', () => {
    config.current = { timing: { clickLeadMs: 240 } };
    render(<ClickCalibration onBack={() => {}} />);
    expect(screen.getByTestId('calib-current')).toHaveTextContent('Now: 240 ms early (measured)');
  });

  it('runs 24 clicks, reports median + IQR, and saves timing.clickLeadMs', async () => {
    render(<ClickCalibration onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByTestId('calib-progress')).toHaveTextContent('Get ready');
    const anchor = T0 + 1500;
    tapAlong(anchor, Array.from({ length: 24 }, (_, i) => 280 + ((i % 3) - 1) * 10));
    await act(async () => { vi.setSystemTime(anchor + 24000); vi.advanceTimersByTime(400); });
    const result = screen.getByTestId('calib-result');
    expect(result).toHaveTextContent('Matched 24 of 24 clicks');
    expect(result).toHaveTextContent('Median delay: 280 ms');
    expect(result).toHaveTextContent('Spread (IQR): 20 ms');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save 280 ms' })); });
    expect(write).toHaveBeenCalledWith({ pianoId: 'p1', keyPath: ['timing', 'clickLeadMs'], value: 280 });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Saved 280 ms.')).toBeTruthy();
  });

  it('offers no Save when too few presses matched, and ignores a key held at Start', async () => {
    store.press(72, T0 - 50); // held before Start: not a press
    render(<ClickCalibration onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const anchor = T0 + 1500;
    tapAlong(anchor, Array.from({ length: 10 }, () => 300));
    await act(async () => { vi.setSystemTime(anchor + 24000); vi.advanceTimersByTime(400); });
    expect(screen.getByTestId('calib-result')).toHaveTextContent('Matched 10 of 24 clicks (10 presses)');
    expect(screen.getByText(/Too few presses/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(write).not.toHaveBeenCalled();
  });
});
