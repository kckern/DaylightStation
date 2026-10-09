import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const midiState = { activeNotes: new Map() };
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => midiState,
  usePianoMidiNotes: () => midiState,
}));

const evaluateMatch = vi.fn(() => 'idle');
vi.mock('../../../PianoFlashcards/flashcardEngine.js', () => ({
  generateCardPitches: () => [60],
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
});
