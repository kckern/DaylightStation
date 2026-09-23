import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const sampled = vi.fn();
vi.mock('../../lib/ui/createAppLogger.js', () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: (...a) => sampled(...a) };
  log.child = () => log;
  return { createAppLogger: () => log };
});

import { useLayoutShiftLog, shortSelector, LAYOUT_SHIFT_BURST_MS } from './useLayoutShiftLog.js';

let instances;
class FakeObserver {
  static supportedEntryTypes = ['layout-shift'];
  constructor(callback) { this.callback = callback; this.disconnect = vi.fn(); instances.push(this); }
  observe(options) { this.options = options; }
  emit(entries) { this.callback({ getEntries: () => entries }); }
}
const node = (tagName, className) => ({ tagName, className });

describe('useLayoutShiftLog', () => {
  const original = window.PerformanceObserver;
  beforeEach(() => { instances = []; sampled.mockReset(); vi.useFakeTimers(); window.PerformanceObserver = FakeObserver; });
  afterEach(() => { vi.useRealTimers(); window.PerformanceObserver = original; });

  it('sums one burst into a single sampled event with route, tab and short source selectors', () => {
    renderHook(() => useLayoutShiftLog({ route: '/health', tab: 'today' }));
    expect(instances[0].options).toEqual({ type: 'layout-shift', buffered: false });
    instances[0].emit([
      { value: 0.05, hadRecentInput: false, sources: [{ node: node('DIV', 'health-suggest__popup extra more') }] },
      { value: 0.02, hadRecentInput: false, sources: [{ node: node('SECTION', 'health-meal') }, { node: { nodeType: 3 } }] },
    ]);
    instances[0].emit([{ value: 0.01, hadRecentInput: false, sources: [{ node: node('LI', '') }, { node: node('P', 'x') }] }]);
    expect(sampled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LAYOUT_SHIFT_BURST_MS);
    expect(sampled).toHaveBeenCalledTimes(1);
    const [event, data, opts] = sampled.mock.calls[0];
    expect(event).toBe('ui.layout-shift');
    expect(data).toEqual({ value: 0.08, count: 3, sources: ['div.health-suggest__popup.extra', 'section.health-meal', 'li'], route: '/health', tab: 'today' });
    expect(opts).toEqual({ maxPerMinute: 20 });
  });

  it('ignores shifts that follow user input', () => {
    renderHook(() => useLayoutShiftLog({ route: '/health', tab: 'today' }));
    instances[0].emit([{ value: 0.3, hadRecentInput: true, sources: [] }]);
    vi.advanceTimersByTime(LAYOUT_SHIFT_BURST_MS * 2);
    expect(sampled).not.toHaveBeenCalled();
  });

  it('a later burst is its own event', () => {
    renderHook(() => useLayoutShiftLog({ route: '/health/progress', tab: 'progress' }));
    instances[0].emit([{ value: 0.1, hadRecentInput: false, sources: [] }]);
    vi.advanceTimersByTime(LAYOUT_SHIFT_BURST_MS);
    instances[0].emit([{ value: 0.2, hadRecentInput: false, sources: [] }]);
    vi.advanceTimersByTime(LAYOUT_SHIFT_BURST_MS);
    expect(sampled.mock.calls.map(([, d]) => d.value)).toEqual([0.1, 0.2]);
  });

  it('does nothing where the browser has no layout-shift support', () => {
    window.PerformanceObserver = class extends FakeObserver { static supportedEntryTypes = ['paint']; };
    renderHook(() => useLayoutShiftLog({}));
    expect(instances).toHaveLength(0);
    window.PerformanceObserver = undefined;
    expect(() => renderHook(() => useLayoutShiftLog({}))).not.toThrow();
  });

  it('flushes a pending burst and disconnects on unmount', () => {
    const { unmount } = renderHook(() => useLayoutShiftLog({ route: '/health', tab: 'today' }));
    instances[0].emit([{ value: 0.04, hadRecentInput: false, sources: [] }]);
    unmount();
    expect(instances[0].disconnect).toHaveBeenCalled();
    expect(sampled).toHaveBeenCalledTimes(1);
  });

  it('shortSelector keeps tag plus two classes', () => {
    expect(shortSelector(node('SPAN', 'a b c'))).toBe('span.a.b');
    expect(shortSelector(null)).toBeNull();
  });
});
