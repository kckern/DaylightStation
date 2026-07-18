import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
vi.mock('./model/index.js', () => ({
  serializeFromEditor: (s) => s.__xml,
  parseMusicXml: (xml) => { if (xml === 'BAD') throw new Error('parse fail'); return { ok: true }; },
}));
import { useAutosave } from './useAutosave.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useAutosave', () => {
  it('debounces then saves valid xml', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, revision: 2 });
    const { rerender } = renderHook(({ st }) => useAutosave({ editorState: st, id: 'x', revision: 1, save, idleMs: 1000 }), { initialProps: { st: { dirty: false, __xml: 'GOOD' } } });
    rerender({ st: { dirty: true, __xml: 'GOOD' } });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(save).toHaveBeenCalledWith('x', { musicxml: 'GOOD', meta: undefined, revision: 1 });
  });
  it('blocks the save when serialized xml fails re-parse (validation gate)', async () => {
    const save = vi.fn();
    const { result, rerender } = renderHook(({ st }) => useAutosave({ editorState: st, id: 'x', revision: 1, save, idleMs: 1000 }), { initialProps: { st: { dirty: false, __xml: 'GOOD' } } });
    rerender({ st: { dirty: true, __xml: 'BAD' } });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe('invalid');
  });
  it('flush() is a no-op when the editor is not dirty (no spurious save on a zero-edit open/close)', async () => {
    const save = vi.fn();
    const { result } = renderHook(({ st }) => useAutosave({ editorState: st, id: 'x', revision: 1, save, idleMs: 1000 }), { initialProps: { st: { dirty: false, __xml: 'GOOD' } } });
    await act(async () => { result.current.flush(); });
    expect(save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RENAME (Task 14). The editor's new title control has to persist through this
// same path — there is no second save route. Two things were actually broken:
// EditorSurface never passed `meta` at all (so `meta: undefined` went up the
// wire and the backend's `meta.title ?? cur.title` always kept the old name),
// and a rename on an UNEDITED song can't reach the wire regardless, because
// both the debounce effect and doSave bail on `!dirty`.
// ---------------------------------------------------------------------------
describe('useAutosave — renaming', () => {
  const clean = { dirty: false, __xml: 'GOOD' };

  it('sends the title as meta so the backend can actually apply it', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, revision: 2 });
    const { rerender } = renderHook(
      ({ st, title }) => useAutosave({ editorState: st, id: 'x', revision: 1, save, title, meta: { title }, idleMs: 1000 }),
      { initialProps: { st: clean, title: 'Old' } },
    );
    rerender({ st: { dirty: true, __xml: 'GOOD' }, title: 'New Name' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(save).toHaveBeenCalledWith('x', { musicxml: 'GOOD', meta: { title: 'New Name' }, revision: 1 });
  });

  it('saves a rename on a song with NO pending edits — the commonest rename there is', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, revision: 2 });
    const { rerender } = renderHook(
      ({ title }) => useAutosave({ editorState: clean, id: 'x', revision: 1, save, title, meta: { title }, idleMs: 1000 }),
      { initialProps: { title: 'Old' } },
    );
    // Open a saved song, rename it, touch nothing else. Before this the editor
    // was clean, so the debounce never even scheduled and the name was lost.
    rerender({ title: 'Renamed' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(save).toHaveBeenCalledWith('x', { musicxml: 'GOOD', meta: { title: 'Renamed' }, revision: 1 });
  });

  it('does not re-save the same title over and over once it has stuck', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, revision: 2 });
    const { rerender } = renderHook(
      ({ title }) => useAutosave({ editorState: clean, id: 'x', revision: 1, save, title, meta: { title }, idleMs: 1000 }),
      { initialProps: { title: 'Old' } },
    );
    rerender({ title: 'Renamed' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(save).toHaveBeenCalledTimes(1);
    rerender({ title: 'Renamed' }); // an unrelated re-render must not re-save
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('naming an UNEDITED draft does not materialize it — creation is still earned by an edit', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'n1', revision: 1 });
    const { rerender } = renderHook(
      ({ title }) => useAutosave({ editorState: clean, id: null, revision: 1, save: vi.fn(), create, title, meta: { title }, idleMs: 1000 }),
      { initialProps: { title: '' } },
    );
    rerender({ title: 'Just A Name' });
    await act(async () => { vi.advanceTimersByTime(2000); });
    // Otherwise opening the mode and idly tapping the title would leave a junk
    // row behind — the exact thing the lazy-materialize design exists to avoid.
    expect(create).not.toHaveBeenCalled();
  });

  it('carries the name into the create when the draft IS finally edited', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'n1', revision: 1 });
    const { rerender } = renderHook(
      ({ st, title }) => useAutosave({ editorState: st, id: null, revision: 1, save: vi.fn(), create, title, meta: { title }, idleMs: 1000 }),
      { initialProps: { st: clean, title: '' } },
    );
    rerender({ st: { dirty: true, __xml: 'GOOD' }, title: 'Named First' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(create).toHaveBeenCalledWith({ title: 'Named First', musicxml: 'GOOD' });
  });
});
