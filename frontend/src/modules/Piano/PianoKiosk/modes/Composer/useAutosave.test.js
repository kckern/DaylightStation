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
