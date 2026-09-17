// ExerciseNotation.feedback.test.jsx — which colour the engraved staff puts on
// the note at the cursor, and why.
//
// THE BUG THIS PINS. `attempting` was `Boolean(activeNotes?.size)` — "is any key
// down anywhere". A scale is played legato, so the instant the assessor graded a
// note correct and advanced, the previous key was still under a finger and that
// alone declared an attempt under way at the NEW note. Nothing had been played
// at it, so no target was held, so it went straight to `exercise-note-wrong`:
// the next note of a perfect scale turned red before the child reached it, once
// per note, all the way up. `SvgSequenceStaff` had been refusing that signal
// since 2026-09-11; this staff never did.
//
// AbcRenderer is mocked into a component that hands back real elements through
// `onRender`, which is the contract `paint()` colours against — so this stays a
// test of the colour decision, not of abcjs's SVG.
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../MusicNotation/renderers/AbcRenderer.jsx', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    AbcRenderer: ({ onRender }) => {
      const ref = useRef(null);
      useEffect(() => {
        const els = [...ref.current.querySelectorAll('[data-note]')];
        onRender?.({}, [els.map((el, index) => ({
          midi: Number(el.dataset.midi), eventIndex: index, els: [el],
        }))]);
      });
      return (
        <div ref={ref} data-testid="abc-renderer">
          <span data-note data-midi="60" />
          <span data-note data-midi="62" />
          <span data-note data-midi="64" />
        </div>
      );
    },
  };
});

const { default: ExerciseNotation } = await import('./ExerciseNotation.jsx');

const instance = {
  key: 'C',
  ordering: 'strict',
  events: [
    { notes: [{ midi: 60, hand: 'right' }] },
    { notes: [{ midi: 62, hand: 'right' }] },
    { notes: [{ midi: 64, hand: 'right' }] },
  ],
};

/** The classes on each engraved note, in order. */
const inks = (container) => [...container.querySelectorAll('[data-note]')]
  .map((el) => [...el.classList].find((name) => name.startsWith('exercise-note-')) ?? null);

const LONG_AGO = Date.now() - 5000;
const IN_A_MOMENT = Date.now() + 5000;

describe('ExerciseNotation — the note at the cursor', () => {
  it('leaves the cursor note alone while the only key down is the one just played', () => {
    // C is still held from event 0, which the engine already graded correct.
    // The cursor is on D and the child has not touched it.
    const { container } = render(
      <ExerciseNotation instance={instance} eventIndex={1} activeNotes={new Map([[60, { timestamp: LONG_AGO }]])} />,
    );
    expect(inks(container)).toEqual(['exercise-note-done', 'exercise-note-next', 'exercise-note-todo']);
  });

  it('turns the cursor note red only for a key played AT it', () => {
    const { container } = render(
      <ExerciseNotation instance={instance} eventIndex={1} activeNotes={new Map([
        [60, { timestamp: LONG_AGO }],
        [65, { timestamp: IN_A_MOMENT }],
      ])} />,
    );
    expect(inks(container)[1]).toBe('exercise-note-wrong');
  });

  it('turns the cursor note green when the key it asked for is the one played', () => {
    const { container } = render(
      <ExerciseNotation instance={instance} eventIndex={1} activeNotes={new Map([
        [60, { timestamp: LONG_AGO }],
        [62, { timestamp: IN_A_MOMENT }],
      ])} />,
    );
    expect(inks(container)[1]).toBe('exercise-note-hit');
  });

  it('marks everything behind the cursor as played, and everything ahead as music', () => {
    const { container } = render(<ExerciseNotation instance={instance} eventIndex={2} />);
    expect(inks(container)).toEqual(['exercise-note-done', 'exercise-note-done', 'exercise-note-next']);
  });
});
