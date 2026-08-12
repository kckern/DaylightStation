import { describe, expect, it } from 'vitest';
import { applyEvent, createSelection, DOUBLE_WINDOW_MS } from './chordSelection.js';

const ev = (sel, type, square, at, extra = {}) =>
  applyEvent(sel, { type, square, at, holdingPiece: false, isEligible: false, ...extra });

/** One complete play: recognised at `at`, released 100ms later. */
const play = (sel, square, at, extra = {}) => {
  const preview = ev(sel, 'preview', square, at, extra);
  if (preview.action.type === 'pickup') return preview;      // lifts under the fingers
  return ev(preview.selection, 'commit', square, at + 100, extra);
};

describe('with no piece in hand', () => {
  it('treats a single chord as a hover, committing nothing', () => {
    expect(play(createSelection(), 'e4', 1000).action).toEqual({ type: 'hover', square: 'e4' });
  });

  it('a preview alone does nothing until it is released', () => {
    expect(ev(createSelection(), 'preview', 'e4', 1000).action).toEqual({ type: 'none' });
  });

  // The window is specified as 800ms (DOUBLE_WINDOW_MS). These two boundary
  // tests deliberately use LITERAL offsets rather than computing them from the
  // imported constant: a test that derives its own expected boundary from the
  // value under test can never fail when that value changes, since both move
  // together. The explicit value is pinned separately below.
  it('the window is specified as 800ms', () => {
    expect(DOUBLE_WINDOW_MS).toBe(800);
  });

  it('picks the piece up when the same square is RECOGNISED again inside the window', () => {
    const first = play(createSelection(), 'e4', 1000);        // released at 1100
    const second = ev(first.selection, 'preview', 'e4', 1100 + 799);
    expect(second.action).toEqual({ type: 'pickup', square: 'e4' });
  });

  it('does not pick up when the second recognition is outside the window', () => {
    const first = play(createSelection(), 'e4', 1000);
    const second = ev(first.selection, 'preview', 'e4', 1100 + 801);
    expect(second.action).toEqual({ type: 'none' });
  });

  it('resets when a different square is played in between', () => {
    let s = play(createSelection(), 'e4', 1000).selection;
    s = play(s, 'd4', 1300).selection;
    const back = ev(s, 'preview', 'e4', 1500);
    expect(back.action).toEqual({ type: 'none' });
  });

  it('swallows the release that follows a pick-up, so it is not a third hover', () => {
    const first = play(createSelection(), 'e4', 1000);
    const pick = ev(first.selection, 'preview', 'e4', 1400);
    expect(pick.action.type).toBe('pickup');
    const release = ev(pick.selection, 'commit', 'e4', 1600);
    expect(release.action).toEqual({ type: 'swallowed' });
  });

  it('is ready for a normal hover after the swallowed release', () => {
    let s = play(createSelection(), 'e4', 1000).selection;
    s = ev(s, 'preview', 'e4', 1400).selection;   // pickup
    s = ev(s, 'commit', 'e4', 1600).selection;    // swallowed
    expect(play(s, 'd4', 1800).action).toEqual({ type: 'hover', square: 'd4' });
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
