// The grace window on useKeepScreenAwake — the thing standing between a singer
// and a dark panel. Regression cover for 2026-08-17, when a singing lecture
// emitted a pause/resume pair every 45s for twelve minutes; each pause released
// the hold, and MIDI/touch (the screensaver's only other activity signals) are
// exactly what someone singing does not produce.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PianoWakeLockProvider } from './usePianoScreensaver.jsx';
import {
  useKeepScreenAwake,
  usePianoWakeLockState,
} from './usePianoScreensaverHooks.js';

const GRACE = 150_000;

function Harness({ active, graceMs, onHeld }) {
  useKeepScreenAwake('video', active, graceMs);
  onHeld(usePianoWakeLockState());
  return null;
}

function setup({ active = true, graceMs = GRACE } = {}) {
  let held = null;
  const onHeld = (v) => { held = v; };
  const ui = (a) => (
    <PianoWakeLockProvider>
      <Harness active={a} graceMs={graceMs} onHeld={onHeld} />
    </PianoWakeLockProvider>
  );
  const r = render(ui(active));
  return { held: () => held, setActive: (a) => act(() => { r.rerender(ui(a)); }), unmount: r.unmount };
}

describe('useKeepScreenAwake grace window', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds while active', () => {
    const h = setup({ active: true });
    expect(h.held()).toBe(true);
  });

  it('keeps holding through a brief pause — the 45s stall cadence', () => {
    const h = setup({ active: true });
    h.setActive(false);
    act(() => { vi.advanceTimersByTime(7_000); }); // longest observed pause was 7.1s
    expect(h.held()).toBe(true);
  });

  it('survives a repeating pause/resume cycle without ever dropping', () => {
    const h = setup({ active: true });
    for (let i = 0; i < 8; i += 1) {          // eight cycles = the observed 12 minutes
      h.setActive(false);
      act(() => { vi.advanceTimersByTime(5_000); });
      expect(h.held()).toBe(true);
      h.setActive(true);
      act(() => { vi.advanceTimersByTime(40_000); });
    }
    expect(h.held()).toBe(true);
  });

  it('releases once the grace elapses — an abandoned tab still sleeps', () => {
    const h = setup({ active: true });
    h.setActive(false);
    act(() => { vi.advanceTimersByTime(GRACE + 1_000); });
    expect(h.held()).toBe(false);
  });

  it('releases immediately when graceMs is 0 (unchanged legacy behaviour)', () => {
    const h = setup({ active: true, graceMs: 0 });
    h.setActive(false);
    expect(h.held()).toBe(false);
  });

  it('releases on unmount without waiting out the grace', () => {
    // The consumer unmounts (viewer left the player) while the PROVIDER stays
    // mounted, so the released state is actually observable — leaving the
    // player must not keep the panel lit for the rest of the grace window.
    let held = null;
    const Observer = () => { held = usePianoWakeLockState(); return null; };
    const ui = (mounted) => (
      <PianoWakeLockProvider>
        {mounted && <Harness active graceMs={GRACE} onHeld={() => {}} />}
        <Observer />
      </PianoWakeLockProvider>
    );
    const r = render(ui(true));
    expect(held).toBe(true);
    act(() => { r.rerender(ui(false)); });
    expect(held).toBe(false);
  });

  it('re-arms the grace on each new pause rather than expiring on the first', () => {
    const h = setup({ active: true });
    h.setActive(false);
    act(() => { vi.advanceTimersByTime(GRACE - 5_000); });
    h.setActive(true);                     // resumed just in time
    h.setActive(false);                    // paused again
    act(() => { vi.advanceTimersByTime(GRACE - 5_000); });
    expect(h.held()).toBe(true);           // fresh window, not the stale one
  });
});
