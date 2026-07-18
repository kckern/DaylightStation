import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => ({ subscribe: () => () => {} }) }));
vi.mock('../../../../MusicNotation/renderers/MusicXmlRenderer.jsx', () => ({
  MusicXmlRenderer: ({ musicXml, children }) => (<div data-testid="renderer" data-xml-len={String(musicXml || '').length}>{children}</div>),
}));
import { EditorSurface, caretStepIndex } from './EditorSurface.jsx';
import { makeEmptyScore, makeNote } from './model/index.js';

describe('EditorSurface', () => {
  it('mounts, renders the score xml, and shows the HUD', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    expect(screen.getByTestId('renderer')).toBeInTheDocument();
    expect(Number(screen.getByTestId('renderer').getAttribute('data-xml-len'))).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toBeInTheDocument(); // the HUD
  });
});

describe('caretStepIndex', () => {
  it('counts a chord (multiple notes, one onset) as a SINGLE engraved step, not one step per note', () => {
    // Measure 0: a 2-note chord (C4 onset + E4 chord-continuation) followed by
    // a melody note (D4). Engraved steps: [chord@onset, melody] = 2 steps.
    // Raw note-array length is 3 — that's the bug this test guards against.
    const chordRoot = makeNote({ step: 'C', octave: 4 });
    const chordTone = makeNote({ step: 'E', octave: 4 }, { chord: true });
    const melody = makeNote({ step: 'D', octave: 4 });
    const score = {
      parts: [{ measures: [{ number: 1, notes: [chordRoot, chordTone, melody] }] }],
    };
    // Caret positioned AFTER all three model entries (noteIdx: 3).
    const caret = { measureIdx: 0, noteIdx: 3 };

    // 2 onset steps precede the caret (the chord counts once, then the melody
    // note) — NOT 3 (raw note count).
    expect(caretStepIndex(score, caret)).toBe(2);
  });

  it('sums onset-only counts across measures before the caret', () => {
    const chordRoot = makeNote({ step: 'C', octave: 4 });
    const chordTone = makeNote({ step: 'G', octave: 4 }, { chord: true });
    const melody = makeNote({ step: 'D', octave: 4 });
    const score = {
      parts: [{
        measures: [
          { number: 1, notes: [chordRoot, chordTone] }, // 1 onset step
          { number: 2, notes: [melody] },
        ],
      }],
    };
    const caret = { measureIdx: 1, noteIdx: 1 };
    expect(caretStepIndex(score, caret)).toBe(2); // 1 (measure 0 chord) + 1 (melody)
  });
});
