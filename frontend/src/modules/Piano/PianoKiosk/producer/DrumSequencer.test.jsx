import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DrumSequencer, drumPatternToTake } from './DrumSequencer.jsx';

describe('drumPatternToTake', () => {
  it('turns active cells into a groove take (GM notes on the 16th grid)', () => {
    // Kick (36) on step 0, Snare (38) on step 4 → ticks 0 and 480 (PPQ 480, 16th=120).
    const take = drumPatternToTake(new Set(['36:0', '38:4']), 1, 1);
    expect(take.kind).toBe('groove');
    expect(take.drumMode).toBe(true);
    expect(take.lengthBars).toBe(1);
    expect(take.ppq).toBe(480);
    expect(take.notes).toEqual([
      { ticks: 0, durationTicks: 120, midi: 36, velocity: 100 },
      { ticks: 480, durationTicks: 120, midi: 38, velocity: 100 },
    ]);
  });

  it('is empty for no active cells', () => {
    expect(drumPatternToTake(new Set(), 2, 1).notes).toEqual([]);
  });
});

describe('DrumSequencer', () => {
  it('renders a row per piece and toggles cells; commit emits the take', () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    render(<DrumSequencer lengthBars={1} onCommit={onCommit} onClose={onClose} />);
    // 6 pieces × 16 steps.
    expect(screen.getByLabelText('Kick step 1')).toBeInTheDocument();
    // Add is disabled until something is on.
    const add = screen.getByRole('button', { name: 'Add drum loop' });
    expect(add).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Kick step 1'));
    fireEvent.click(screen.getByLabelText('Snare step 5'));
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(onCommit).toHaveBeenCalledTimes(1);
    const take = onCommit.mock.calls[0][0];
    expect(take.notes.map((n) => n.midi).sort()).toEqual([36, 38]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('caps the grid at 4 bars', () => {
    render(<DrumSequencer lengthBars={16} onCommit={vi.fn()} onClose={vi.fn()} />);
    // 4 bars × 16 = 64 steps → last kick step labelled 64.
    expect(screen.getByLabelText('Kick step 64')).toBeInTheDocument();
    expect(screen.queryByLabelText('Kick step 65')).toBeNull();
  });
});
