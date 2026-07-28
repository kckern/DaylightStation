import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useWhoPromptAutoClose } from './useWhoPromptAutoClose.js';

const base = { open: true, videoActive: false, playing: false, currentUser: 'kc' };

describe('useWhoPromptAutoClose', () => {
  it('closes when a video lecture mounts while the prompt is open (F7)', () => {
    const close = vi.fn();
    const { rerender } = renderHook((p) => useWhoPromptAutoClose(p), {
      initialProps: { ...base, close },
    });
    expect(close).not.toHaveBeenCalled();
    rerender({ ...base, close, videoActive: true });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes when audio playback starts while the prompt is open (F7)', () => {
    const close = vi.fn();
    const { rerender } = renderHook((p) => useWhoPromptAutoClose(p), {
      initialProps: { ...base, close },
    });
    rerender({ ...base, close, playing: true });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes when the player changes elsewhere while the prompt is open (F8)', () => {
    const close = vi.fn();
    const { rerender } = renderHook((p) => useWhoPromptAutoClose(p), {
      initialProps: { ...base, close },
    });
    rerender({ ...base, close, currentUser: 'alice' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does NOT close just because the prompt opened with a user already set', () => {
    const close = vi.fn();
    const { rerender } = renderHook((p) => useWhoPromptAutoClose(p), {
      initialProps: { ...base, close, open: false },
    });
    rerender({ ...base, close, open: true });
    expect(close).not.toHaveBeenCalled();
  });

  it('does nothing while the prompt is closed', () => {
    const close = vi.fn();
    const { rerender } = renderHook((p) => useWhoPromptAutoClose(p), {
      initialProps: { ...base, close, open: false },
    });
    rerender({ ...base, close, open: false, videoActive: true, currentUser: 'alice' });
    expect(close).not.toHaveBeenCalled();
  });

  it('closes if the prompt opens while playback is already active (missed race)', () => {
    const close = vi.fn();
    const { rerender } = renderHook((p) => useWhoPromptAutoClose(p), {
      initialProps: { ...base, close, open: false, videoActive: true },
    });
    rerender({ ...base, close, open: true, videoActive: true });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
