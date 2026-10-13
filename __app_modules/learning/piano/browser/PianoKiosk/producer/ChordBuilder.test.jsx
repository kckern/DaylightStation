import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChordBuilder } from './ChordBuilder.jsx';
import { chordTriadMidi, chordProgressionToTake, voiceLeadChord } from './chordBuilderModel.js';

const I = { roman: 'I', offset: 0, quality: 'major' };
const V = { roman: 'V', offset: 7, quality: 'major' };

describe('chord voicing', () => {
  it('spells canonical-C triads deterministically', () => {
    expect(chordTriadMidi(I)).toEqual([60, 64, 67]);
    expect(chordTriadMidi({ offset: 9, quality: 'minor' })).toEqual([69, 72, 76]);
  });

  it('voice-leads I → V through the nearest inversion instead of jumping root position', () => {
    const first = voiceLeadChord(I);
    const second = voiceLeadChord(V, first);
    expect(first).toEqual([60, 64, 67]);
    expect(second).toEqual([59, 62, 67]); // B-D-G, all voices move <= 2 semitones
  });
});

describe('chordProgressionToTake', () => {
  it('builds a dynamic quarter-pulse part with harmonic/provenance metadata', () => {
    const take = chordProgressionToTake([I, null, V], { rhythm: 'pulse' });
    expect(take).toMatchObject({
      kind: 'chords', lengthBars: 3, drumMode: false,
      builder: { kind: 'chords', version: 1, rhythm: 'pulse', roman: ['I', null, 'V'] },
      timeline: { root: 0, specificity: 'triad' },
    });
    expect(take.timeline.slots).toHaveLength(12);
    expect(take.notes.filter((n) => n.ticks === 0).map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(take.notes.filter((n) => n.ticks === 3840).map((n) => n.midi)).toEqual([59, 62, 67]);
    expect(take.notes.some((n) => n.ticks === 1920)).toBe(false);
    expect(new Set(take.notes.map((n) => n.velocity)).size).toBeGreaterThan(1);
  });

  it('supports sustain and syncopated rhythms without changing loop length', () => {
    const sustain = chordProgressionToTake([I], { rhythm: 'sustain' });
    const sync = chordProgressionToTake([I], { rhythm: 'syncopated' });
    expect(sustain.notes).toHaveLength(3);
    expect(sync.notes).toHaveLength(6);
    expect(sustain.lengthBars).toBe(1);
    expect(sync.lengthBars).toBe(1);
  });
});

describe('ChordBuilder', () => {
  it('uses keyed labels, previews without committing, and then commits the exact rhythm choice', () => {
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    const onClose = vi.fn();
    render(<ChordBuilder keyPc={2} lengthBars={2} onCommit={onCommit} onPreview={onPreview} onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'add D' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'add D' }));
    fireEvent.click(screen.getByRole('button', { name: 'add A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Syncopated' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({
      lengthBars: 2,
      builder: expect.objectContaining({ rhythm: 'syncopated' }),
    }));
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add chords' }));
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({
      builder: expect.objectContaining({ roman: ['I', 'V'] }),
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('supports the same 16-bar maximum as the Loop workspace', () => {
    render(<ChordBuilder lengthBars={16} onCommit={vi.fn()} onPreview={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'bar 16 empty' })).toBeInTheDocument();
  });
});
