// frontend/src/lib/ui/useSheetSubmission.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSheetSubmission } from './useSheetSubmission.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

describe('useSheetSubmission', () => {
  it('saves, reports saving while in flight, then closes the sheet with the result handled', async () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetSubmission(onClose));
    const d = deferred();
    let run;
    act(() => { run = result.current.run(() => d.promise); });
    expect(result.current.saving).toBe(true);
    await act(async () => { d.resolve('ok'); await run; });
    expect(result.current.saving).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.failure).toBeNull();
  });

  it('admits one save at a time; a second run while in flight never calls save', async () => {
    const { result } = renderHook(() => useSheetSubmission(() => {}));
    const d = deferred();
    const save1 = vi.fn(() => d.promise);
    const save2 = vi.fn(async () => {});
    let first;
    act(() => { first = result.current.run(save1); });
    await act(async () => { await result.current.run(save2); });
    expect(save2).not.toHaveBeenCalled();
    await act(async () => { d.resolve(); await first; });
    await act(async () => { await result.current.run(save2); });
    expect(save2).toHaveBeenCalledTimes(1);
  });

  it('does nothing when valid is false', async () => {
    const save = vi.fn();
    const { result } = renderHook(() => useSheetSubmission(() => {}));
    await act(async () => { await result.current.run(save, { valid: false }); });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it('a failure is kept, onError hears it, the sheet stays open and the next save clears it', async () => {
    const onClose = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useSheetSubmission(onClose, onError));
    const boom = new Error('nope');
    await act(async () => { await result.current.run(() => Promise.reject(boom)); });
    expect(result.current.failure).toBe(boom);
    expect(onError).toHaveBeenCalledWith(boom);
    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
    await act(async () => { await result.current.run(async () => 1); });
    expect(result.current.failure).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clearFailure resets the failure', async () => {
    const { result } = renderHook(() => useSheetSubmission(() => {}));
    await act(async () => { await result.current.run(() => Promise.reject(new Error('x'))); });
    act(() => result.current.clearFailure());
    expect(result.current.failure).toBeNull();
  });

  it('onSuccess replaces the default close and receives the result', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSheetSubmission(onClose));
    await act(async () => { await result.current.run(async () => 42, { onSuccess }); });
    expect(onSuccess).toHaveBeenCalledWith(42);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('submit prevents the form default and honours the valid flag', async () => {
    const { result } = renderHook(() => useSheetSubmission(() => {}));
    const event = { preventDefault: vi.fn() };
    const save = vi.fn(async () => {});
    await act(async () => { await result.current.submit(event, save, false); });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    await act(async () => { await result.current.submit(event, save); });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('after unmount a settling save neither closes nor sets state, but errors still reach onError', async () => {
    const onClose = vi.fn();
    const onError = vi.fn();
    const { result, unmount } = renderHook(() => useSheetSubmission(onClose, onError));
    const ok = deferred();
    let p1;
    act(() => { p1 = result.current.run(() => ok.promise); });
    unmount();
    await act(async () => { ok.resolve(); await p1; });
    expect(onClose).not.toHaveBeenCalled();
    // an unmounted sheet cannot start new saves
    const save = vi.fn();
    await result.current.run(save);
    expect(save).not.toHaveBeenCalled();
  });

  it('error from a save that settles after unmount still notifies onError', async () => {
    const onError = vi.fn();
    const { result, unmount } = renderHook(() => useSheetSubmission(() => {}, onError));
    const d = deferred();
    let p;
    act(() => { p = result.current.run(() => d.promise); });
    unmount();
    const err = new Error('late');
    await act(async () => { d.reject(err); await p; });
    expect(onError).toHaveBeenCalledWith(err);
  });
});
