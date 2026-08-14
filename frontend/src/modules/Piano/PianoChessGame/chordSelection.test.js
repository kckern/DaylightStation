import { describe, expect, it } from 'vitest';
import { applyEvent, createSelection, DOUBLE_WINDOW_MS } from './chordSelection.js';

const ev = (sel, type, square, at, extra = {}) =>
  applyEvent(sel, { type, square, at, holdingPiece: false, isEligible: false, ...extra });

/** One complete play: recognised at `at`, released 100ms later. */
const play = (sel, square, at, extra = {}) => {
  const preview = ev(sel, 'preview', square, at, extra);
  return ev(preview.selection, 'commit', square, at + 100, extra);
};

describe('with no piece in hand', () => {
  it('treats a single chord as a hover, committing nothing', () => {
    expect(play(createSelection(), 'e4', 1000).action).toEqual({ type: 'hover', square: 'e4' });
  });

  it('a preview alone does nothing until it is released', () => {
    expect(ev(createSelection(), 'preview', 'e4', 1000).action).toEqual({ type: 'none' });
  });

  // The window is specified as 2500ms (DOUBLE_WINDOW_MS). These two boundary
  // tests deliberately use LITERAL offsets rather than computing them from the
  // imported constant: a test that derives its own expected boundary from the
  // value under test can never fail when that value changes, since both move
  // together. The explicit value is pinned separately below.
  it('the window is specified as 2500ms', () => {
    expect(DOUBLE_WINDOW_MS).toBe(2500);
  });

  it('picks the piece up when the same square is RELEASED again inside the window', () => {
    const first = play(createSelection(), 'e4', 1000);        // released at 1100
    const second = ev(first.selection, 'commit', 'e4', 1100 + 2499);
    expect(second.action).toEqual({ type: 'pickup', square: 'e4' });
  });

  it('does not pick up when the second release is outside the window', () => {
    const first = play(createSelection(), 'e4', 1000);
    const second = ev(first.selection, 'commit', 'e4', 1100 + 2501);
    expect(second.action).toEqual({ type: 'hover', square: 'e4' });
  });

  it('resets when a different square is played in between', () => {
    let s = play(createSelection(), 'e4', 1000).selection;
    s = play(s, 'd4', 1300).selection;
    const back = ev(s, 'commit', 'e4', 1500);
    expect(back.action).toEqual({ type: 'hover', square: 'e4' });
  });

  it('never picks a piece up from an in-progress preview', () => {
    const first = play(createSelection(), 'e4', 1000);
    const preview = ev(first.selection, 'preview', 'e4', 1400);
    expect(preview.action).toEqual({ type: 'none' });
    expect(ev(preview.selection, 'commit', 'e4', 1600).action)
      .toEqual({ type: 'pickup', square: 'e4' });
  });
});

describe('with a piece in hand', () => {
  const held = { holdingPiece: true };

  it('drops on a single play when the square is eligible', () => {
    expect(play(createSelection(), 'e5', 1000, { ...held, isEligible: true }).action)
      .toEqual({ type: 'drop', square: 'e5' });
  });

  it('only hovers an ineligible square — exploring is never punished', () => {
    expect(play(createSelection(), 'h8', 1000, held).action).toEqual({ type: 'hover', square: 'h8' });
  });

  it('never picks up while already holding, however fast the repeat', () => {
    const first = play(createSelection(), 'h8', 1000, held);
    const second = ev(first.selection, 'preview', 'h8', 1150, held);
    expect(second.action.type).not.toBe('pickup');
  });
});

describe('an unrecognised chord', () => {
  it('is refused when choosing a piece', () => {
    expect(play(createSelection(), null, 1000).action).toEqual({ type: 'refuse', square: null });
  });

  it('is silent while a piece is in hand', () => {
    expect(play(createSelection(), null, 1000, { holdingPiece: true }).action)
      .toEqual({ type: 'hover', square: null });
  });
});
