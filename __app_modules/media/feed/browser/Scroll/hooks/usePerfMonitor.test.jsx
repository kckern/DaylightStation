import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePerfMonitor } from './usePerfMonitor.js';

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info }) }) }));
vi.mock('@/lib/perf/memoryProbe.js', () => ({ heapSnapshotFields: () => ({}), reportMemoryMonitoringAvailability: () => {} }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('measures only foreground frames and excludes the hidden interval from jank', () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const hook = renderHook(() => usePerfMonitor(true, undefined, 100));
  act(() => vi.advanceTimersByTime(1000));
  expect(info).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  act(() => vi.advanceTimersByTime(100));
  expect(info).toHaveBeenCalledWith('perf.snapshot', expect.objectContaining({ droppedFrames: 0 }));
  hook.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
