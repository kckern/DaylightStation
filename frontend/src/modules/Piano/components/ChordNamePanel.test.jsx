import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ChordNamePanel } from './ChordNamePanel.jsx';

const C = 60, E = 64, G = 67, Bb = 70;

describe('ChordNamePanel — sticky decay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows a live chord immediately', () => {
    render(<ChordNamePanel midiNotes={[C, E, G]} />);
    expect(screen.getByText('C major')).toBeInTheDocument();
  });

  it('lingers the last chord on release, then clears after holdMs', () => {
    const { rerender } = render(<ChordNamePanel midiNotes={[C, E, G]} holdMs={500} />);
    expect(screen.getByText('C major')).toBeInTheDocument();

    rerender(<ChordNamePanel midiNotes={[]} holdMs={500} />); // keys released
    expect(screen.getByText('C major')).toBeInTheDocument();  // still lingering
    expect(document.querySelector('.piano-chord-name__plaque').className).toContain('is-held');

    act(() => vi.advanceTimersByTime(400)); // before the hold expires
    expect(screen.getByText('C major')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(200)); // past holdMs
    expect(screen.queryByText('C major')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('a new chord replaces the lingering one after the onset settle', () => {
    const { rerender } = render(<ChordNamePanel midiNotes={[C, E, G]} holdMs={500} settleMs={80} />);
    rerender(<ChordNamePanel midiNotes={[]} holdMs={500} settleMs={80} />);          // release → linger C major
    rerender(<ChordNamePanel midiNotes={[E, G, Bb, C + 12]} holdMs={500} settleMs={80} />); // C7/E arrives
    // Hysteresis: the new chord must settle before it replaces the lingering one.
    expect(screen.getByText('C major')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(80));
    expect(screen.getByText('C 7 / E')).toBeInTheDocument();
    expect(screen.queryByText('C major')).toBeNull();
  });

  it('does not flash a transient partial chord that is replaced mid-roll', () => {
    // Roll into C major: a bare C+G interval (reads as C5) briefly, then the full triad.
    const { rerender } = render(<ChordNamePanel midiNotes={[]} settleMs={80} />);
    rerender(<ChordNamePanel midiNotes={[C, G]} settleMs={80} />);   // transient "C5"
    act(() => vi.advanceTimersByTime(40));
    rerender(<ChordNamePanel midiNotes={[C, E, G]} settleMs={80} />); // full C major before settle
    expect(screen.queryByText('C5')).toBeNull();                     // transient never showed
    act(() => vi.advanceTimersByTime(80));
    expect(screen.getByText('C major')).toBeInTheDocument();
  });
});
