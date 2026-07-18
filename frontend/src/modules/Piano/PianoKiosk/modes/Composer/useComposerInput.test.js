import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { mapKey, useComposerInput, KEY_LEGEND } from './useComposerInput.js';
import { makeEmptyScore, initEditor } from './model/index.js';

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
});

describe('KEY_LEGEND (on-screen help SSOT)', () => {
  it('documents only keys that are actually wired — every legend code maps to a command', () => {
    // The one exception is the `🎹` row, which documents armed piano-note entry
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
    for (const code of ['Numpad1', 'Numpad3', 'Numpad5', 'Numpad7', 'Numpad9', 'Numpad4', 'Numpad0', 'NumpadDecimal', 'NumpadSubtract', 'Backspace', 'Delete']) {
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
