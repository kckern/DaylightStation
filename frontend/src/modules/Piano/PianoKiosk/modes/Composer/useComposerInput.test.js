import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { mapKey, useComposerInput, KEY_LEGEND, CHORD_ONSET_TOLERANCE_MS, MAX_PENDING_ONSET_MS } from './useComposerInput.js';
import { makeEmptyScore, initEditor, undo } from './model/index.js';
import { intern, KIND, __resetRecorder, __snapshotForTest } from '../../../../../lib/logging/inputRecorder.js';

// A stub logger with vi.fn() spies on every method the hook calls, so tests can
// assert on the STRUCTURED events (task 27) without a real transport.
function mockLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: vi.fn() };
}
const eventNames = (log) => log.sampled.mock.calls.map((c) => c[0]);
const eventPayload = (log, name) => log.sampled.mock.calls.find((c) => c[0] === name)?.[1];
const eventPayloads = (log, name) => log.sampled.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

describe('mapKey (numpad)', () => {
  it('maps duration + arm + rest + delete codes', () => {
    expect(mapKey('Numpad5')).toEqual({ kind: 'duration', type: 'quarter' });
    expect(mapKey('Numpad3')).toEqual({ kind: 'duration', type: 'eighth' });
    expect(mapKey('Numpad9')).toEqual({ kind: 'duration', type: 'whole' });
    expect(mapKey('Numpad4')).toEqual({ kind: 'arm' });
    expect(mapKey('Numpad0')).toEqual({ kind: 'rest' });
    expect(mapKey('NumpadSubtract')).toEqual({ kind: 'deleteBack' });
    expect(mapKey('NumpadDecimal')).toEqual({ kind: 'dot' });
    expect(mapKey('KeyQ')).toBeNull();
  });

  it('maps NumpadEnter to play/pause (the spec\'s transport key)', () => {
    expect(mapKey('NumpadEnter')).toEqual({ kind: 'play' });
  });
});

describe('KEY_LEGEND (on-screen help SSOT)', () => {
  it('documents only keys that are actually wired — every legend code maps to a command', () => {
    // The one exception is the `Piano` row, which documents armed piano-note entry
    // (it comes through the MIDI subscription, not a keydown) and carries code null.
    for (const section of KEY_LEGEND) {
      for (const entry of section.keys) {
        if (entry.code == null) continue;
        expect(mapKey(entry.code), `legend key "${entry.label}" (${entry.code}) should map to a command`).not.toBeNull();
      }
    }
  });

  it('covers every duration/arm/rest/dot/delete command the keymap exposes', () => {
    // A guard against silently adding a wired key without documenting it. The
    // caret-navigation codes are represented by the "← →" / "PgUp / PgDn" rows
    // whose sample codes (ArrowLeft / PageUp) stand in for their pairs.
    const documented = new Set(KEY_LEGEND.flatMap((s) => s.keys.map((k) => k.code)));
    for (const code of ['Numpad1', 'Numpad3', 'Numpad5', 'Numpad7', 'Numpad9', 'Numpad4', 'Numpad0', 'NumpadDecimal', 'NumpadSubtract', 'Backspace', 'Delete', 'NumpadEnter']) {
      expect(documented.has(code), `mapped key ${code} should appear in KEY_LEGEND`).toBe(true);
    }
  });
});

describe('useComposerInput delete keys', () => {
  // Regression: both delete keys used to route to deleteAtCaret, which no-ops
  // when the caret sits past the last note — i.e. right after entering one,
  // the commonest state. These drive the real keydown path, since mapKey
  // already reported 'deleteBack' correctly while the switch ignored it.
  it.each(['NumpadSubtract', 'Backspace'])('%s deletes the note just entered', (code) => {
    let state = initEditor(makeEmptyScore());
    const setEditorState = vi.fn((fn) => { state = typeof fn === 'function' ? fn(state) : fn; });
    let midiFn;
    renderHook(() => useComposerInput({ setEditorState, subscribe: (fn) => { midiFn = fn; return () => {}; } }));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' })); });
    act(() => { midiFn({ type: 'note_on', note: 60, velocity: 80 }); });
    act(() => { midiFn({ type: 'note_on', note: 62, velocity: 80 }); });
    expect(state.score.parts[0].measures[0].notes).toHaveLength(2);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code })); });
    expect(state.score.parts[0].measures[0].notes.map((n) => n.midi)).toEqual([60]);
  });

  it('Delete leaves the score alone when the caret sits past the last note', () => {
    let state = initEditor(makeEmptyScore());
    const setEditorState = vi.fn((fn) => { state = typeof fn === 'function' ? fn(state) : fn; });
    let midiFn;
    renderHook(() => useComposerInput({ setEditorState, subscribe: (fn) => { midiFn = fn; return () => {}; } }));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' })); });
    act(() => { midiFn({ type: 'note_on', note: 60, velocity: 80 }); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Delete' })); });
    expect(state.score.parts[0].measures[0].notes).toHaveLength(1);
  });
});

describe('useComposerInput text-entry guard', () => {
  // The keydown listener lives on `window`, so without a guard a Composer text
  // field (the rename box, added in a later unit) would be un-editable: Backspace
  // would be preventDefault()ed away AND would delete a note behind the field.
  it.each(['Backspace', 'Delete', 'Numpad0'])('%s targeting an <input> neither edits the score nor is preventDefault()ed', (code) => {
    let state = initEditor(makeEmptyScore());
    const setEditorState = vi.fn((fn) => { state = typeof fn === 'function' ? fn(state) : fn; });
    let midiFn;
    renderHook(() => useComposerInput({ setEditorState, subscribe: (fn) => { midiFn = fn; return () => {}; } }));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' })); });
    act(() => { midiFn({ type: 'note_on', note: 60, velocity: 80 }); });
    const before = state;

    const input = document.createElement('input');
    document.body.appendChild(input);
    const evt = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(evt); });

    expect(state).toBe(before); // score untouched
    expect(evt.defaultPrevented).toBe(false); // the field keeps its native behavior
    input.remove();
  });

  it('still handles a key targeting a non-input element', () => {
    let state = initEditor(makeEmptyScore());
    const setEditorState = vi.fn((fn) => { state = typeof fn === 'function' ? fn(state) : fn; });
    let midiFn;
    renderHook(() => useComposerInput({ setEditorState, subscribe: (fn) => { midiFn = fn; return () => {}; } }));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' })); });
    act(() => { midiFn({ type: 'note_on', note: 60, velocity: 80 }); });

    const div = document.createElement('div');
    document.body.appendChild(div);
    act(() => { div.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backspace', bubbles: true, cancelable: true })); });

    expect(state.score.parts[0].measures[0].notes).toHaveLength(0);
    div.remove();
  });
});

describe('useComposerInput MIDI entry', () => {
  it('armed note-on inserts a note at the sticky duration; disarmed does not edit', () => {
    let state = initEditor(makeEmptyScore());
    const setEditorState = vi.fn((fn) => { state = typeof fn === 'function' ? fn(state) : fn; });
    let midiFn;
    const subscribe = (fn) => { midiFn = fn; return () => {}; };
    const { result } = renderHook(() => useComposerInput({ setEditorState, subscribe }));
    // arm via keydown, then play a note
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' })); });
    expect(result.current.armed).toBe(true);
    act(() => { midiFn({ type: 'note_on', note: 60, velocity: 80 }); });
    expect(state.score.parts[0].measures[0].notes.length).toBe(1);
    // disarm, play again — no new note
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' })); });
    act(() => { midiFn({ type: 'note_on', note: 62, velocity: 80 }); });
    expect(state.score.parts[0].measures[0].notes.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Task 5 — input telemetry into the zero-alloc recorder ring, ALONGSIDE the
// existing semantic logs. A mapped numpad keydown lands a KEY row; a model
// mutation (here: the armed MIDI note insert) lands an EDIT row. These feed the
// backend .jsonl trace the session logger persists.
// ---------------------------------------------------------------------------
describe('useComposerInput recorder capture', () => {
  it('records a KEY row for a mapped numpad keydown', () => {
    const setEditorState = vi.fn();
    renderHook(() => useComposerInput({ setEditorState, subscribe: () => () => {} }));
    __resetRecorder();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad5' })); });
    const hit = __snapshotForTest().records.some((r) => r.kind === KIND.KEY && r.a === intern('Numpad5'));
    expect(hit).toBe(true);
  });

  it('records an EDIT insert-note row (with the midi note) for an armed MIDI note-on', () => {
    let state = initEditor(makeEmptyScore());
    const setEditorState = vi.fn((fn) => { state = typeof fn === 'function' ? fn(state) : fn; });
    let midiFn;
    renderHook(() => useComposerInput({ setEditorState, subscribe: (fn) => { midiFn = fn; return () => {}; } }));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' })); }); // arm Write
    __resetRecorder(); // isolate the note-on's records from the arm keydown's
    act(() => { midiFn({ type: 'note_on', note: 67, velocity: 80 }); });
    const hit = __snapshotForTest().records.some(
      (r) => r.kind === KIND.EDIT && r.a === intern('insert-note') && r.b === 67,
    );
    expect(hit).toBe(true);
  });

  // The bar a note lands in IS the feature ("insert-note C4 quarter @bar3").
  // recordEdit used to hardcode measure 0, so every EDIT row falsely claimed
  // bar 1. The caret measure is threaded in via caretMeasureRef so the MIDI
  // callback reads the LIVE caret, not a stale closure.
  it('carries the caret measure into the insert-note EDIT row (slot c)', () => {
    let state = initEditor(makeEmptyScore());
    const setEditorState = vi.fn((fn) => { state = typeof fn === 'function' ? fn(state) : fn; });
    let midiFn;
    const caretMeasureRef = { current: 2 }; // caret parked on the third bar
    renderHook(() => useComposerInput({ setEditorState, subscribe: (fn) => { midiFn = fn; return () => {}; }, caretMeasureRef }));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' })); }); // arm Write
    __resetRecorder();
    act(() => { midiFn({ type: 'note_on', note: 67, velocity: 80 }); });
    const row = __snapshotForTest().records.find(
      (r) => r.kind === KIND.EDIT && r.a === intern('insert-note'),
    );
    expect(row).toBeTruthy();
    expect(row.c).toBe(2);
  });
});

describe('useComposerInput transport key', () => {
  it('NumpadEnter calls onTogglePlay and does not touch the score', () => {
    let state = initEditor(makeEmptyScore());
    const setEditorState = vi.fn((fn) => { state = typeof fn === 'function' ? fn(state) : fn; });
    const onTogglePlay = vi.fn();
    renderHook(() => useComposerInput({ setEditorState, subscribe: () => () => {}, onTogglePlay }));
    const before = state;
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'NumpadEnter' })); });
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    expect(state).toBe(before);
  });

  it('NumpadEnter inside a text field is ignored (Enter belongs to the field)', () => {
    const onTogglePlay = vi.fn();
    renderHook(() => useComposerInput({ setEditorState: vi.fn(), subscribe: () => () => {}, onTogglePlay }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { code: 'NumpadEnter', bubbles: true, cancelable: true })); });
    expect(onTogglePlay).not.toHaveBeenCalled();
    input.remove();
  });
});

describe('useComposerInput playback echo guard', () => {
  // DATA-CORRUPTION GUARD. Playback sends notes OUT over Web MIDI; on the kiosk
  // the Jamcorder may route them straight back IN. With Write armed, an echoed
  // note-on is indistinguishable from a played one — so an unguarded editor
  // would silently re-record the entire playback into the score.
  it('an armed note-on does NOT insert while the transport is playing', () => {
    let state = initEditor(makeEmptyScore());
    const setEditorState = vi.fn((fn) => { state = typeof fn === 'function' ? fn(state) : fn; });
    let midiFn;
    const subscribe = (fn) => { midiFn = fn; return () => {}; };
    const { rerender } = renderHook(
      ({ playing }) => useComposerInput({ setEditorState, subscribe, playing }),
      { initialProps: { playing: false } },
    );
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' })); }); // arm
    act(() => { midiFn({ type: 'note_on', note: 60, velocity: 80 }); });
    expect(state.score.parts[0].measures[0].notes).toHaveLength(1);

    rerender({ playing: true });
    act(() => { midiFn({ type: 'note_on', note: 62, velocity: 80 }); });
    act(() => { midiFn({ type: 'note_on', note: 64, velocity: 80 }); });
    expect(state.score.parts[0].measures[0].notes, 'playback echo must not be recorded').toHaveLength(1);

    // …and entry resumes the moment playback stops (the guard must not latch).
    rerender({ playing: false });
    act(() => { midiFn({ type: 'note_on', note: 65, velocity: 80 }); });
    expect(state.score.parts[0].measures[0].notes).toHaveLength(2);
  });

  it('leaves the arm flag alone, so Write is still on after playback', () => {
    const { result, rerender } = renderHook(
      ({ playing }) => useComposerInput({ setEditorState: vi.fn(), subscribe: () => () => {}, playing }),
      { initialProps: { playing: false } },
    );
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' })); });
    rerender({ playing: true });
    expect(result.current.armed).toBe(true);
    rerender({ playing: false });
    expect(result.current.armed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 27 — structured note-entry logging + duration classification.
//
// Recon finding (see task-27-report.md): this pipeline has NO chord-grouping
// logic today — every armed note-on inserts as its own independent note,
// regardless of timing. `composer.input.chord-decision` is a DIAGNOSTIC log
// only (grouped/size describe what WOULD happen under CHORD_ONSET_TOLERANCE_MS,
// not actual behavior) — these tests assert the measurement is correct, not
// that grouping happens (it doesn't, by design, in this task).
// ---------------------------------------------------------------------------
describe('useComposerInput note-entry logging (task 27)', () => {
  function armedHarness(logger = mockLogger()) {
    let state = initEditor(makeEmptyScore());
    const setEditorState = vi.fn((fn) => { state = typeof fn === 'function' ? fn(state) : fn; });
    let midiFn;
    renderHook(() => useComposerInput({
      setEditorState, subscribe: (fn) => { midiFn = fn; return () => {}; }, logger,
    }));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' })); }); // arm Write
    return { logger, midi: (evt) => act(() => { midiFn(evt); }), getState: () => state };
  }

  it('logs a note-on event for every note_on, armed or not', () => {
    const { logger, midi } = armedHarness();
    midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 });
    const payload = eventPayload(logger, 'composer.input.note-on');
    expect(payload).toMatchObject({ note: 60, velocity: 80, t: 1000 });
  });

  it('logs a note-off event for every note_off, even with nothing pending', () => {
    const { logger, midi } = armedHarness();
    midi({ type: 'note_off', note: 60, time: 500 }); // no matching note_on
    expect(eventPayload(logger, 'composer.input.note-off')).toMatchObject({ note: 60, t: 500 });
    expect(eventNames(logger)).not.toContain('composer.input.note-duration');
  });

  describe('chord-decision diagnostic', () => {
    it('first note-on in a run has no previous onset: spreadMs null, size 1, not grouped', () => {
      const { logger, midi } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 });
      expect(eventPayload(logger, 'composer.input.chord-decision')).toMatchObject({
        spreadMs: null, toleranceMs: CHORD_ONSET_TOLERANCE_MS, grouped: false, size: 1,
      });
    });

    it('a note-on within tolerance of the previous one is flagged grouped, cluster grows', () => {
      const { logger, midi } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 });
      midi({ type: 'note_on', note: 64, velocity: 80, time: 1000 + CHORD_ONSET_TOLERANCE_MS }); // exactly at the boundary
      midi({ type: 'note_on', note: 67, velocity: 80, time: 1000 + CHORD_ONSET_TOLERANCE_MS + 5 });
      const decisions = eventPayloads(logger, 'composer.input.chord-decision');
      expect(decisions[1]).toMatchObject({ spreadMs: CHORD_ONSET_TOLERANCE_MS, grouped: true, size: 2 });
      expect(decisions[2]).toMatchObject({ spreadMs: 5, grouped: true, size: 3 });
    });

    it('a note-on beyond tolerance is NOT grouped and resets the cluster to size 1', () => {
      const { logger, midi } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 });
      midi({ type: 'note_on', note: 64, velocity: 80, time: 1000 + CHORD_ONSET_TOLERANCE_MS + 1 });
      const decisions = eventPayloads(logger, 'composer.input.chord-decision');
      expect(decisions[1]).toMatchObject({ spreadMs: CHORD_ONSET_TOLERANCE_MS + 1, grouped: false, size: 1 });
    });

    it('does NOT actually group notes into a chord — every note-on still appends its own sequential note', () => {
      // This is the honest-recon assertion: the diagnostic log can say
      // grouped:true, but insertion behavior is untouched by this task.
      const { midi, getState } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 });
      midi({ type: 'note_on', note: 64, velocity: 80, time: 1005 });
      midi({ type: 'note_on', note: 67, velocity: 80, time: 1008 });
      expect(getState().score.parts[0].measures[0].notes).toHaveLength(3);
      expect(getState().score.parts[0].measures[0].notes.every((n) => !n.chord)).toBe(true);
    });
  });

  describe('duration classification (short/medium/long -> 16th/eighth/quarter)', () => {
    it('a short held note (< 150ms) is reclassified to 16th on release', () => {
      const { logger, midi, getState } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 });
      midi({ type: 'note_off', note: 60, time: 1080 }); // heldMs = 80
      expect(eventPayload(logger, 'composer.input.note-duration')).toMatchObject({
        note: 60, heldMs: 80, class: 'short', type: '16th',
      });
      expect(getState().score.parts[0].measures[0].notes[0].type).toBe('16th');
    });

    // Fix round 1 (probe-verified review finding): the note_off reclassify
    // write used to route through applyCommand, which always pushes a SECOND
    // history entry (it has no no-op short-circuit for "this just patches the
    // insert that already recorded history"). Insert-then-classify must read
    // as ONE atomic edit for undo — one press should remove the whole note,
    // not just downgrade its type back toward the default first.
    it('insert + release-time reclassify is ONE history entry — one undo removes the whole note', () => {
      const { getState, midi } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 });
      midi({ type: 'note_off', note: 60, time: 1080 }); // heldMs = 80 -> '16th' (observable vs. the 'quarter' default)
      const settled = getState();
      expect(settled.score.parts[0].measures[0].notes).toHaveLength(1);
      expect(settled.score.parts[0].measures[0].notes[0].type).toBe('16th'); // classification did apply
      expect(settled.history.past).toHaveLength(1); // NOT two — insert + classify collapsed to one entry

      const afterUndo = undo(settled);
      expect(afterUndo.score.parts[0].measures[0].notes).toHaveLength(0); // one undo removes the note entirely
    });

    it('a medium held note (150-449ms) is reclassified to eighth on release', () => {
      const { getState, midi } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 });
      midi({ type: 'note_off', note: 60, time: 1300 }); // heldMs = 300
      expect(getState().score.parts[0].measures[0].notes[0].type).toBe('eighth');
    });

    it('a long held note (>= 450ms) is reclassified to quarter on release', () => {
      const { getState, midi } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 });
      midi({ type: 'note_off', note: 60, time: 1600 }); // heldMs = 600
      expect(getState().score.parts[0].measures[0].notes[0].type).toBe('quarter');
    });

    it('a chord (3 notes pressed together, released together) reclassifies each note independently', () => {
      const { getState, midi } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 });
      midi({ type: 'note_on', note: 64, velocity: 80, time: 1003 });
      midi({ type: 'note_on', note: 67, velocity: 80, time: 1006 });
      // released out of onset order, held for very different lengths — the
      // entryTag correlation (not array position) must still resolve each one
      midi({ type: 'note_off', note: 67, time: 1006 + 80 });   // short  -> 16th
      midi({ type: 'note_off', note: 60, time: 1000 + 300 });  // medium -> eighth
      midi({ type: 'note_off', note: 64, time: 1003 + 600 });  // long   -> quarter
      const notes = getState().score.parts[0].measures[0].notes;
      expect(notes.find((n) => n.midi === 60).type).toBe('eighth');
      expect(notes.find((n) => n.midi === 64).type).toBe('quarter');
      expect(notes.find((n) => n.midi === 67).type).toBe('16th');
    });

    it('the same pitch pressed twice before either releases resolves FIFO (first on, first off)', () => {
      const { getState, midi } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 }); // will hold 600ms -> quarter
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1010 }); // will hold 80ms -> 16th
      midi({ type: 'note_off', note: 60, time: 1600 }); // resolves the FIRST pending (1000 -> 600ms)
      midi({ type: 'note_off', note: 60, time: 1090 }); // resolves the SECOND pending (1010 -> 80ms)
      const notes = getState().score.parts[0].measures[0].notes;
      expect(notes).toHaveLength(2);
      expect(notes[0].type).toBe('quarter');
      expect(notes[1].type).toBe('16th');
    });

    it('a stray note_off with no pending entry does not touch the score', () => {
      const { getState, midi } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 });
      midi({ type: 'note_off', note: 60, time: 1600 }); // resolves it (-> quarter)
      const before = getState();
      midi({ type: 'note_off', note: 60, time: 2000 }); // nothing pending now
      expect(getState()).toBe(before); // no-op, same state reference
    });

    it('a dropped note_off no longer poisons later presses of the same pitch — stale onsets evict', () => {
      const { logger, getState, midi } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 }); // its note_off is DROPPED (BLE)
      const later = 1000 + MAX_PENDING_ONSET_MS + 1000;
      midi({ type: 'note_on', note: 60, velocity: 80, time: later });     // the sweep evicts the stale head here
      midi({ type: 'note_off', note: 60, time: later + 80 });             // an 80ms hold on the SECOND press
      const notes = getState().score.parts[0].measures[0].notes;
      expect(notes).toHaveLength(2);
      expect(notes[0].type).toBe('quarter'); // the abandoned note keeps its inserted default — never late-reclassified
      expect(notes[1].type).toBe('16th');    // the note_off resolved the FRESH onset, not the stale head
      // eventNames() only surfaces log.sampled calls; the eviction is a warn-level
      // event, so assert it directly rather than widening the helper.
      expect(logger.warn).toHaveBeenCalledWith('composer.input.onset-evicted', expect.objectContaining({ note: 60 }));
    });

    it('disarmed play-along (audition) is never reclassified — no pending entry is created', () => {
      const { getState, logger, midi } = armedHarness();
      // disarm
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' })); });
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 });
      midi({ type: 'note_off', note: 60, time: 1600 });
      expect(getState().score.parts[0].measures[0].notes).toHaveLength(0);
      expect(eventNames(logger)).not.toContain('composer.input.note-duration');
    });
  });
});
