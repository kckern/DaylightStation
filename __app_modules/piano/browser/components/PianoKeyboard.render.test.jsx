import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Spy on getNoteName so we can count how many KEYS actually (re)render: each
// PianoKey computes its own label via getNoteName, so a call == that key rendered.
vi.mock('../noteUtils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getNoteName: vi.fn((note, prefer) => actual.getNoteName(note, prefer)) };
});

import { getNoteName } from '../noteUtils.js';
import { PianoKeyboard } from './PianoKeyboard.jsx';

const map = (entries) => new Map(entries);

describe('PianoKeyboard render efficiency', () => {
  it('re-renders only the changed key when a single note toggles', () => {
    const startNote = 60;
    const endNote = 71; // one octave, enough to prove only one key re-renders
    const { rerender } = render(
      <PianoKeyboard startNote={startNote} endNote={endNote} activeNotes={map([])} />,
    );

    // Every key rendered once on mount; now watch what re-renders on a 1-note change.
    getNoteName.mockClear();
    rerender(
      <PianoKeyboard startNote={startNote} endNote={endNote} activeNotes={map([[62, { velocity: 100 }]])} />,
    );

    const reRenderedNotes = getNoteName.mock.calls.map((c) => c[0]);
    // The pegged-CPU bug: every note rebuilt all 12 keys. Fixed: only key 62.
    expect(reRenderedNotes).toContain(62);
    expect(reRenderedNotes.length).toBeLessThanOrEqual(2);
  });

  it('still lights the correct keys (behavior preserved)', () => {
    const { container, rerender } = render(
      <PianoKeyboard startNote={60} endNote={71} activeNotes={map([[64, { velocity: 80 }]])} />,
    );
    expect(container.querySelector('[data-note="64"]').classList.contains('active')).toBe(true);
    expect(container.querySelector('[data-note="65"]').classList.contains('active')).toBe(false);

    rerender(<PianoKeyboard startNote={60} endNote={71} activeNotes={map([[65, { velocity: 80 }]])} />);
    expect(container.querySelector('[data-note="64"]').classList.contains('active')).toBe(false);
    expect(container.querySelector('[data-note="65"]').classList.contains('active')).toBe(true);
  });
});
