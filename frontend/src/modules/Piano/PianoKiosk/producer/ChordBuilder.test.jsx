import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChordBuilder, chordTriadMidi, chordProgressionToTake } from './ChordBuilder.jsx';

describe('chordTriadMidi', () => {
  it('voices canonical-C triads (Roman I = C = 60)', () => {
    expect(chordTriadMidi({ offset: 0, quality: 'major' })).toEqual([60, 64, 67]); // C E G
    expect(chordTriadMidi({ offset: 9, quality: 'minor' })).toEqual([69, 72, 76]); // A C E
    expect(chordTriadMidi({ offset: 11, quality: 'dim' })).toEqual([71, 74, 77]); // B D F
  });
});

describe('chordProgressionToTake', () => {
  it('lays each filled bar as a whole-bar canonical chord', () => {
    const slots = [
      { roman: 'I', offset: 0, quality: 'major' },
      null,
      { roman: 'V', offset: 7, quality: 'major' },
    ];
    const take = chordProgressionToTake(slots, 1);
    expect(take.kind).toBe('chords');
    expect(take.lengthBars).toBe(3);
    // Bar 0 = C major at tick 0; bar 2 = G major at tick 3840 (2 bars × 1920).
    expect(take.notes.filter((n) => n.ticks === 0).map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(take.notes.filter((n) => n.ticks === 3840).map((n) => n.midi)).toEqual([67, 71, 74]);
    // The empty bar 1 contributes nothing.
    expect(take.notes.some((n) => n.ticks === 1920)).toBe(false);
  });
});

describe('ChordBuilder', () => {
  it('shows keyed palette names for the jam key and fills slots on tap', () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    // keyPc 2 = D → Roman I labelled "D", V labelled "A".
    render(<ChordBuilder keyPc={2} lengthBars={2} onCommit={onCommit} onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'add D' })).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add chords' });
    expect(add).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'add D' }));  // bar 1 ← I
    fireEvent.click(screen.getByRole('button', { name: 'add A' }));  // bar 2 ← V (auto-advanced)
    expect(add).toBeEnabled();
    fireEvent.click(add);
    const take = onCommit.mock.calls[0][0];
    // Canonical: bar 0 C major (60,64,67), bar 1 G major (67,71,74).
    expect(take.notes.filter((n) => n.ticks === 0).map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(take.notes.filter((n) => n.ticks === 1920).map((n) => n.midi)).toEqual([67, 71, 74]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
