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

describe("GateCeremony — a host's own verdict on the same curtain", () => {
  it('is the game gate ceremony when nothing is handed in', () => {
    const { container } = render(<GateCeremony gameId="connect-four" score={1} onDone={() => {}} />);
    const root = container.querySelector('.gate-ceremony');
    expect(root.getAttribute('aria-label')).toBe('Gate cleared. Connect Four unlocked.');
    expect(root.hasAttribute('data-host')).toBe(false);
    expect(root.style.getPropertyValue('--gate-run')).toBe('');
    expect(container.querySelector('.gate-ceremony__word').textContent).toBe('Cleared');
    expect(container.querySelector('.gate-ceremony__unlocked').textContent).toBe('Unlocked');
    expect(container.querySelector('.gate-ceremony__mark')).toBeNull();
  });

  it("carries a host's word and mark, and parts onto what the host names", () => {
    const { container } = render(<GateCeremony word="Silver!" mark={<svg data-testid="coin" />} announce="Bars 1–5. Silver!"
      behind={{ mark: <svg data-testid="next" />, eyebrow: 'Next', label: 'Bars 6–9' }} onDone={() => {}} />);
    const root = container.querySelector('.gate-ceremony');
    expect(root.getAttribute('aria-label')).toBe('Bars 1–5. Silver!');
    expect(container.querySelector('.gate-ceremony__verdict').textContent).toBe('Silver!');
    expect(container.querySelector('.gate-ceremony__mark [data-testid="coin"]')).not.toBeNull();
    expect(container.querySelector('.gate-ceremony__behind').textContent).toBe('NextBars 6–9');
    expect(container.querySelector('.gate-ceremony__icon [data-testid="next"]')).not.toBeNull();
  });

  it('runs as long as the host asks, and scales the curtain with it', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { container } = render(<GateCeremony word="All Gold!" durationMs={6400} onDone={onDone} />);
    expect(container.querySelector('.gate-ceremony').style.getPropertyValue('--gate-run')).toBe('6000ms');
    act(() => vi.advanceTimersByTime(CEREMONY_MS + 100));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(6400 - CEREMONY_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

