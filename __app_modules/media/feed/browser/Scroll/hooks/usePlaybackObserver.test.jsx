import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePlaybackObserver } from './usePlaybackObserver.js';

vi.mock('../feedLog.js', () => ({ feedLog: { player: vi.fn() } }));

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('suspends presentation reads when hidden and immediately samples the continuing player on return', () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const media = { paused: false, playbackRate: 1 };
  const player = { getCurrentTime: vi.fn(() => 3), getDuration: () => 10, getMediaElement: () => media };
  const ref = { current: player };
  const hook = renderHook(() => usePlaybackObserver(ref, true));
  act(() => vi.advanceTimersByTime(500));
  expect(hook.result.current.currentTime).toBe(3);
  visibility.mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  player.getCurrentTime.mockClear().mockReturnValue(7);
  act(() => vi.advanceTimersByTime(2000));
  expect(player.getCurrentTime).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(hook.result.current.currentTime).toBe(7);
  hook.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('paints each mounted progress bar from the same frame sample and releases it on stop', () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const player = { getDuration: () => 20, getCurrentTime: vi.fn(() => 5) };
  const ref = { current: player };
  const hook = renderHook(({ active }) => usePlaybackObserver(ref, active), { initialProps: { active: true } });
  const mini = document.createElement('div');
  const detail = document.createElement('div');
  const sheet = document.createElement('div');
  hook.result.current.progressElRef.current = mini;
  hook.result.current.detailProgressElRef.current = detail;
  hook.result.current.sheetProgressElRef.current = sheet;
  act(() => vi.advanceTimersToNextFrame());
  expect(mini.style.width).toBe('25%');
  expect(detail.style.width).toBe('25%');
  expect(sheet.style.width).toBe('25%');
  expect(player.getCurrentTime).toHaveBeenCalledTimes(1);
  hook.result.current.detailProgressElRef.current = null;
  player.getCurrentTime.mockReturnValue(10);
  act(() => vi.advanceTimersToNextFrame());
  expect(mini.style.width).toBe('50%');
  expect(detail.style.width).toBe('25%');
  expect(sheet.style.width).toBe('50%');

  hook.result.current.sheetProgressElRef.current = null;
  sheet.style.width = '80%';
  ref.current = null;
  act(() => vi.advanceTimersToNextFrame());
  expect(mini.style.width).toBe('0%');
  expect(sheet.style.width).toBe('80%');

  hook.result.current.sheetProgressElRef.current = sheet;
  act(() => vi.advanceTimersToNextFrame());
  expect(sheet.style.width).toBe('0%');

  const replacement = { getDuration: () => 80, getCurrentTime: vi.fn(() => 8) };
  ref.current = replacement;
  act(() => vi.advanceTimersToNextFrame());
  expect(sheet.style.width).toBe('10%');
  expect(replacement.getCurrentTime).toHaveBeenCalledTimes(1);

  hook.rerender({ active: false });
  expect(vi.getTimerCount()).toBe(0);
  hook.unmount();
});
