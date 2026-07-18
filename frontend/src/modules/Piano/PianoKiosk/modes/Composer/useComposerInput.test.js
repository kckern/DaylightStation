import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { mapKey, useComposerInput } from './useComposerInput.js';
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
