import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const midiState = { activeNotes: new Map() };
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => midiState,
  usePianoMidiNotes: () => midiState,
}));

const evaluateMatch = vi.fn(() => 'idle');
const picks = { queue: [] };
vi.mock('../../../PianoFlashcards/flashcardEngine.js', () => ({
  generateCardPitches: () => (picks.queue.length ? [picks.queue.shift()] : [60]),
  evaluateMatch: (...a) => evaluateMatch(...a),
}));

// Render the shared flashcard staff as a stub that surfaces its props.
vi.mock('../../../components/ActionStaff.jsx', () => ({
  ActionStaff: ({ targetPitches, matched }) => (
    <div
      data-testid="action-staff"
      data-target={JSON.stringify(targetPitches)}
      data-matched={String(matched)}
    />
  ),
}));

import EngagementGate from './EngagementGate.jsx';

beforeEach(() => {
  midiState.activeNotes = new Map();
  evaluateMatch.mockReset();
  evaluateMatch.mockReturnValue('idle');
  picks.queue = [];
});

describe('EngagementGate', () => {
  it('renders nothing when open is false', () => {
    render(<EngagementGate open={false} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('engagement-gate')).toBeNull();
  });

  it('renders the prompt dialog with a flashcard staff when open is true', () => {
    render(<EngagementGate open={true} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('engagement-gate')).toBeTruthy();
    // renders the shared flashcard staff seeded with the target pitch (MIDI 60)
    const staff = screen.getByTestId('action-staff');
    expect(staff).toBeTruthy();
    expect(staff.getAttribute('data-target')).toBe('[60]');
  });

  it('calls onDismiss when the played note matches (correct)', () => {
    evaluateMatch.mockReturnValue('correct');
    midiState.activeNotes = new Map([[60, { note: 60 }]]);
    const onDismiss = vi.fn();
    render(<EngagementGate open={true} onDismiss={onDismiss} />);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('does NOT call onDismiss when the note is wrong', () => {
    evaluateMatch.mockReturnValue('wrong');
    midiState.activeNotes = new Map([[61, { note: 61 }]]);
    const onDismiss = vi.fn();
    render(<EngagementGate open={true} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('answers only from the human-held keys when given (a loop conga on the target does not count)', () => {
    midiState.activeNotes = new Map([[60, { note: 60 }]]); // the store sees the loop's note
    render(<EngagementGate open={true} onDismiss={vi.fn()} humanNotes={new Map()} />);
    expect(evaluateMatch).toHaveBeenCalledWith(new Map(), [60]);
  });

  it('never asks for a pitch the rhythm loop is playing', () => {
    picks.queue = [62, 64, 63, 65];
    render(<EngagementGate open={true} onDismiss={vi.fn()} avoidPitches={() => new Set([62, 63, 64])} />);
    expect(screen.getByTestId('action-staff').getAttribute('data-target')).toBe('[65]');
  });
});
