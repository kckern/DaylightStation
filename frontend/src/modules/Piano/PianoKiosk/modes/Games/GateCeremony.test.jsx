import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import GateCeremony, { CEREMONY_MS } from './GateCeremony.jsx';

vi.mock('../../../gameRegistry.js', () => ({
  getGameEntry: () => ({ label: 'Connect Four', icon: 'game' }),
}));
vi.mock('../../../ui/icons/Icon.jsx', () => ({ default: () => null }));

afterEach(() => { vi.useRealTimers(); });

describe('GateCeremony — the curtain always parts', () => {
  it('hands over after CEREMONY_MS', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<GateCeremony gameId="connect-four" score={1} onDone={onDone} />);
    act(() => vi.advanceTimersByTime(CEREMONY_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('hands over even while its parent re-renders it faster than the curtain lasts', () => {
    // THE REGRESSION. The gate re-renders on every MIDI note and on every note
    // bridge reconnect, and it passes an inline arrow as `onDone`. A hand-over
    // effect keyed on that callback re-armed itself on each of those renders,
    // so a child resting a hand on the keys held "Cleared" on screen and the
    // game never arrived (seen in prod 2026-09-08: 18.4s to open one game,
    // two others abandoned). The curtain must be armed once, on mount.
    vi.useFakeTimers();
    const onDone = vi.fn();

    function Parent() {
      const [renders, setRenders] = useState(0);
      // A fresh closure every render, exactly as GameGate hands one over.
      return (
        <>
          <button type="button" onClick={() => setRenders((n) => n + 1)}>note</button>
          <GateCeremony gameId="connect-four" score={1} onDone={() => onDone(renders)} />
        </>
      );
    }

    const { getByText } = render(<Parent />);
    // Note events every 250ms — never a 3.4s gap — for most of the curtain.
    // The clock is advanced to exactly CEREMONY_MS from MOUNT and no further:
    // a timer that re-armed on each render is still counting at that instant.
    const churn = 12;
    const step = 250;
    for (let i = 0; i < churn; i += 1) {
      act(() => { getByText('note').click(); vi.advanceTimersByTime(step); });
    }
    act(() => vi.advanceTimersByTime(CEREMONY_MS - churn * step));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
