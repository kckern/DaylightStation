import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useTakeRecorder from './useTakeRecorder.js';

// The real hook opens an actual microphone; word ladder only needs to know
// this wrapper judges what `useVoiceCapture` hands it, so the capture layer
// itself is mocked and its `onTake`/`onDenied` handlers captured for the
// test to fire directly — standing in for a real recorder finishing a take.
const captured = vi.hoisted(() => ({ opts: null }));
vi.mock('../../SentenceLadder/rungs/useVoiceCapture.js', () => ({
  default: vi.fn((opts) => {
    captured.opts = opts;
    return {
      start: vi.fn(async () => true),
      stop: vi.fn(() => {}),
      cancel: vi.fn(() => {}),
      release: vi.fn(() => {}),
      isRecording: vi.fn(() => false),
      stream: { id: 'mock-stream' },
    };
  }),
}));

describe('useTakeRecorder', () => {
  it('starts idle, and start() moves to recording', async () => {
    const { result } = renderHook(() => useTakeRecorder({ onTake: vi.fn() }));
    expect(result.current.phase).toBe('idle');
    await act(async () => { await result.current.start(); });
    expect(result.current.phase).toBe('recording');
  });

  it('a take never heard (heard:false) refuses too-quiet and never calls onTake', async () => {
    const onTake = vi.fn();
    const { result } = renderHook(() => useTakeRecorder({ onTake }));
    await act(async () => { await result.current.start(); });
    act(() => { result.current.onLevel(0.01); }); // below SILENT_LEVEL — never heard
    act(() => { captured.opts.onTake({ blob: new Blob(['x']), durationMs: 2000 }); });
    expect(onTake).not.toHaveBeenCalled();
    expect(result.current.verdict).toBe('too-quiet');
    expect(result.current.phase).toBe('idle');
  });

  it('a good take (heard, long enough) calls onTake with the blob', async () => {
    const onTake = vi.fn();
    const { result } = renderHook(() => useTakeRecorder({ onTake }));
    await act(async () => { await result.current.start(); });
    act(() => { result.current.onLevel(0.5); }); // above SILENT_LEVEL
    const blob = new Blob(['x']);
    act(() => { captured.opts.onTake({ blob, durationMs: 2000 }); });
    expect(onTake).toHaveBeenCalledWith({ blob, durationMs: 2000 });
    expect(result.current.verdict).toBeNull();
  });

  it('a loud-enough but too-short take refuses too-short and never calls onTake', async () => {
    const onTake = vi.fn();
    const { result } = renderHook(() => useTakeRecorder({ onTake }));
    await act(async () => { await result.current.start(); });
    act(() => { result.current.onLevel(0.5); });
    act(() => { captured.opts.onTake({ blob: new Blob(['x']), durationMs: 500 }); });
    expect(onTake).not.toHaveBeenCalled();
    expect(result.current.verdict).toBe('too-short');
  });

  it('a take with no level sample at all (no band rendered) is judged on length alone', async () => {
    const onTake = vi.fn();
    const { result } = renderHook(() => useTakeRecorder({ onTake }));
    await act(async () => { await result.current.start(); });
    // onLevel never called — sampled stays false, so loudness cannot refuse it.
    act(() => { captured.opts.onTake({ blob: new Blob(['x']), durationMs: 2000 }); });
    expect(onTake).toHaveBeenCalled();
    expect(result.current.verdict).toBeNull();
  });

  it('stop() moves phase to saving and calls the capture layer\'s stop', async () => {
    const { result } = renderHook(() => useTakeRecorder({ onTake: vi.fn() }));
    await act(async () => { await result.current.start(); });
    act(() => { result.current.stop(); });
    expect(result.current.phase).toBe('saving');
  });

  it('a denied microphone returns to idle without a verdict', async () => {
    const { result } = renderHook(() => useTakeRecorder({ onTake: vi.fn() }));
    await act(async () => { captured.opts.onDenied(new Error('denied')); });
    expect(result.current.phase).toBe('idle');
    expect(result.current.verdict).toBeNull();
  });

  it('a denied (or failed) microphone marks the recorder unavailable; a later good start clears it', async () => {
    const { result } = renderHook(() => useTakeRecorder({ onTake: vi.fn() }));
    await act(async () => { captured.opts.onDenied(new Error('denied')); });
    expect(result.current.unavailable).toBe(true);
    await act(async () => { await result.current.start(); });
    expect(result.current.unavailable).toBe(false);
  });

  it('a device with no microphone API is unavailable from the start', () => {
    const original = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const { result } = renderHook(() => useTakeRecorder({ onTake: vi.fn() }));
    expect(result.current.unavailable).toBe(true);
    Object.defineProperty(navigator, 'mediaDevices', { value: original, configurable: true });
  });

  it('a take stopped, then unmounted, whose onstop fires late never reaches onTake', async () => {
    const onTake = vi.fn();
    const { result, unmount } = renderHook(() => useTakeRecorder({ onTake }));
    await act(async () => { await result.current.start(); });
    act(() => { result.current.onLevel(0.5); });
    act(() => { result.current.stop(); });
    unmount();
    // MediaRecorder's onstop arrives after the item is gone (Stop -> Next).
    captured.opts.onTake({ blob: new Blob(['x']), durationMs: 2000 });
    expect(onTake).not.toHaveBeenCalled();
  });
});
