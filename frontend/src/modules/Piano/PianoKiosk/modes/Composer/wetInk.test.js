import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { pendingAppendDiff, useWetInk } from './wetInk.js';
import { makeEmptyScore, makeNote } from './model/index.js';
import { initEditor, insertNote, deleteNote, moveCaret, setAttribute } from './model/editor.js';

const C4 = { step: 'C', octave: 4, alter: 0 };

/** Build a real score carrying `n` quarter notes, through the real editor API. */
function withNotes(n) {
  let s = initEditor(makeEmptyScore());
  for (let i = 0; i < n; i++) s = insertNote(s, C4, { type: 'quarter' });
  return s.score;
}

describe('pendingAppendDiff', () => {
  it('reports no change for identical scores', () => {
    const a = withNotes(2);
    expect(pendingAppendDiff(a, withNotes(2))).toEqual({ measureIdx: null, notes: [] });
  });

  it('reports a single appended note as wet ink in its measure', () => {
    const diff = pendingAppendDiff(withNotes(2), withNotes(3));
    expect(diff.measureIdx).toBe(0);
    expect(diff.notes).toHaveLength(1);
    expect(diff.notes[0].pitch).toEqual(C4);
  });

  it('reports several appended notes at once', () => {
    const diff = pendingAppendDiff(withNotes(1), withNotes(3));
    expect(diff.measureIdx).toBe(0);
    expect(diff.notes).toHaveLength(2);
  });

  it('demands a settle when a note was deleted', () => {
    const settled = withNotes(3);
    const live = deleteNote(initEditor(settled), { measureIdx: 0, noteIdx: 1 }).score;
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  it('demands a settle when an existing note changed', () => {
    const settled = withNotes(3);
    const live = structuredClone(settled);
    live.parts[0].measures[0].notes[0].pitch.step = 'D';
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  it('demands a settle when two different measures grew', () => {
    const settled = withNotes(5); // bar 0 full (4 quarters), bar 1 holds 1
    expect(settled.parts[0].measures).toHaveLength(2);
    const live = structuredClone(settled);
    live.parts[0].measures[0].notes.push(makeNote(C4, { type: 'quarter' }));
    live.parts[0].measures[1].notes.push(makeNote(C4, { type: 'quarter' }));
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  // A new measure means a new BARLINE, which the lightweight wet-ink layer cannot
  // draw — only an OSMD engrave can. insertNote opens the next measure both when a
  // note exactly fills the bar and when one straddles it, so both must settle.
  it('demands a settle when the note that exactly fills the bar opens a new measure', () => {
    const settled = withNotes(3);
    const live = withNotes(4);
    expect(settled.parts[0].measures).toHaveLength(1);
    expect(live.parts[0].measures).toHaveLength(2);
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  it('demands a settle when a note straddles the barline into a new measure', () => {
    const settled = withNotes(3); // 72 of 96 divisions used → 24 left
    const live = insertNote(initEditor(settled), C4, { type: 'whole' }).score;
    expect(live.parts[0].measures.length).toBeGreaterThan(1);
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  // Wet ink can only paint past the end of the engraving; growing an earlier
  // measure reflows every bar to its right. deleteNote doesn't reflow, so this
  // shape is reachable by ordinary input: fill a bar, delete from it, walk the
  // caret back, type.
  it('demands a settle when the grown measure is not the last one', () => {
    let s = initEditor(makeEmptyScore());
    for (let i = 0; i < 5; i++) s = insertNote(s, C4, { type: 'quarter' });
    s = deleteNote(s, { measureIdx: 0, noteIdx: 1 }); // bar 0 now underfull
    const settled = s.score;
    expect(settled.parts[0].measures).toHaveLength(2);

    s = moveCaret(s, 'prevBar');
    expect(s.caret.measureIdx).toBe(0);
    const live = insertNote(s, C4, { type: 'quarter' }).score;

    // The append really did land in the non-final bar 0, and it must still settle.
    expect(live.parts[0].measures[0].notes).toHaveLength(4);
    expect(live.parts[0].measures).toHaveLength(2);
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  // Forward-looking: unreachable from the Composer input path today, but a chord
  // member shares its principal's onset and would be mis-drawn as a sequential
  // note by the wet-ink layer.
  it('demands a settle when an appended note is a chord member', () => {
    const settled = withNotes(2);
    const live = structuredClone(settled);
    live.parts[0].measures[0].notes.push(makeNote(C4, { type: 'quarter', chord: true }));
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  it('demands a settle when the part count differs', () => {
    const settled = withNotes(2);
    const live = structuredClone(settled);
    live.parts.push({ id: 'P2', name: 'Music', staves: 1, clefs: {}, measures: [{ number: 1, notes: [] }] });
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  // Score-level attribute edits touch no note, so a notes-only comparison would
  // read them as "nothing changed" and the caller would never engrave the new key
  // signature. The envelope is compared too, precisely to close that hole.
  it('demands a settle when a score attribute changed but no note did', () => {
    const settled = withNotes(2);
    const live = setAttribute(initEditor(settled), 'key', { fifths: 2 }).score;
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  it('treats a missing or malformed score as a settle rather than a no-op', () => {
    expect(pendingAppendDiff(withNotes(2), null)).toBeNull();
    expect(pendingAppendDiff(null, withNotes(2))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useWetInk — the settle POLICY on top of the pure diff.
// ---------------------------------------------------------------------------

/** Editor states after each of `n` successive quarter-note inserts: [s0…sn]. */
function trail(n) {
  const out = [initEditor(makeEmptyScore())];
  for (let i = 0; i < n; i++) out.push(insertNote(out[out.length - 1], C4, { type: 'quarter' }));
  return out;
}

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** renderHook harness driving the hook with real editor states. */
function driveWetInk(initial, logger, idleMs = 600) {
  return renderHook(
    ({ st }) => useWetInk({ score: st.score, caretMeasureIdx: st.caret.measureIdx, idleMs, logger }),
    { initialProps: { st: initial } }
  );
}

describe('useWetInk', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds the settled score back and reports the appended note as pending', () => {
    const [s0, s1] = trail(1);
    const { result, rerender } = driveWetInk(s0, mkLogger());
    rerender({ st: s1 });
    expect(result.current.settledScore).toBe(s0.score); // NOT re-engraved yet
    expect(result.current.pending.notes).toHaveLength(1);
  });

  it('settles after idleMs of quiet, clearing the wet ink', () => {
    const [s0, s1] = trail(1);
    const logger = mkLogger();
    const { result, rerender } = driveWetInk(s0, logger);
    rerender({ st: s1 });
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current.settledScore).toBe(s1.score);
    expect(result.current.pending.notes).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith('composer.wetink.settle', expect.objectContaining({ reason: 'idle' }));
  });

  it('settles IMMEDIATELY on a delete (a structural change wet ink cannot express)', () => {
    const [, , s2] = trail(2);
    const deleted = deleteNote(s2, { measureIdx: 0, noteIdx: 0 });
    const logger = mkLogger();
    const { result, rerender } = driveWetInk(s2, logger);
    rerender({ st: deleted });
    // No timer advanced — the settle must already have happened.
    expect(result.current.settledScore).toBe(deleted.score);
    expect(result.current.pending.notes).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith('composer.wetink.settle', { reason: 'structural' });
  });

  it('settles IMMEDIATELY when a note opens a new measure (a barline only OSMD can draw)', () => {
    const t = trail(4);
    const logger = mkLogger();
    const { result, rerender } = driveWetInk(t[3], logger);
    rerender({ st: t[4] }); // the 4th quarter exactly fills the bar → new measure
    expect(t[4].score.parts[0].measures).toHaveLength(2);
    expect(result.current.settledScore).toBe(t[4].score);
    expect(logger.info).toHaveBeenCalledWith('composer.wetink.settle', { reason: 'structural' });
  });

  it('settles IMMEDIATELY when the caret has left the measure the ink is drying in', () => {
    // Ink pending in bar 0, but the caret reports bar 1 — the kid moved on, so
    // the wet layer is painting somewhere the caret no longer is.
    const [s0, s1] = trail(1);
    const logger = mkLogger();
    const { result, rerender } = renderHook(
      ({ score, m }) => useWetInk({ score, caretMeasureIdx: m, idleMs: 600, logger }),
      { initialProps: { score: s0.score, m: 0 } }
    );
    rerender({ score: s1.score, m: 1 });
    expect(result.current.settledScore).toBe(s1.score);
    expect(logger.info).toHaveBeenCalledWith('composer.wetink.settle', { reason: 'measure-exit' });
  });

  // THE load test for the two-trigger design: unbroken fast entry never pauses,
  // so the idle timer alone would leave ink wet forever. The bar boundary is what
  // bounds it — settled is never more than one bar behind (spec §2.1).
  it('a rapid burst with no idle gap stays wet until the bar boundary, then settles', () => {
    const t = trail(4);
    const logger = mkLogger();
    const { result, rerender } = driveWetInk(t[0], logger);
    for (const st of [t[1], t[2], t[3]]) rerender({ st }); // no timer advance between
    expect(result.current.settledScore).toBe(t[0].score); // still zero engraves
    expect(result.current.pending.notes).toHaveLength(3);
    expect(logger.info).not.toHaveBeenCalled();

    rerender({ st: t[4] }); // this one fills the bar → ensureMeasure → settle
    expect(result.current.settledScore).toBe(t[4].score);
    expect(result.current.pending.notes).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith('composer.wetink.settle', { reason: 'structural' });
  });

  // Regression guard: the idle timer is rescheduled on every keystroke, so a
  // cleared-but-never-rescheduled timer would strand settledScore behind forever.
  it('reschedules the idle timer across a burst rather than stranding the settle', () => {
    const t = trail(3);
    const { result, rerender } = driveWetInk(t[0], mkLogger());
    rerender({ st: t[1] });
    act(() => { vi.advanceTimersByTime(400); }); // not yet
    rerender({ st: t[2] });
    act(() => { vi.advanceTimersByTime(400); }); // 800ms since t[1] but only 400 since t[2]
    expect(result.current.settledScore).toBe(t[0].score);
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.settledScore).toBe(t[2].score);
  });

  it('does not settle, or log, when nothing has changed', () => {
    const [s0] = trail(0);
    const logger = mkLogger();
    const { result } = driveWetInk(s0, logger);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.settledScore).toBe(s0.score);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
