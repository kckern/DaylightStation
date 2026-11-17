import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSchoolInvalidation } from './useSchoolInvalidation.js';

function eventSource(connected = true) {
  const subscriptions = new Set(); const statuses = new Set();
  return {
    subscribe(topics, callback) { const item = { topics, callback }; subscriptions.add(item); return () => subscriptions.delete(item); },
    onStatusChange(callback) { statuses.add(callback); callback({ connected }); return () => statuses.delete(callback); },
    getStatus: () => ({ connected }),
    emit(message) { for (const item of subscriptions) if (item.topics.includes(message.topic)) item.callback(message); },
    status(value) { connected = value; statuses.forEach(callback => callback({ connected })); },
    get counts() { return [subscriptions.size, statuses.size]; },
  };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('School invalidation', () => {
  it('coalesces matching mutations across flat and State Gates envelopes, and excludes room commands', () => {
    vi.useFakeTimers(); const source = eventSource(); const refresh = vi.fn();
    renderHook(() => useSchoolInvalidation({ refresh, learnerId: 'kid', topics: ['school', 'state-gates'], events: source }));
    act(() => {
      source.emit({ topic: 'school', event: 'coins-changed', learnerId: 'other' });
      source.emit({ topic: 'school', type: 'school.launch', learnerId: 'kid', target: { kind: 'bank' } });
    });
    act(() => vi.advanceTimersByTime(800)); expect(refresh).not.toHaveBeenCalled();
    act(() => {
      source.emit({ topic: 'school', event: 'assessment-changed', learnerId: 'kid' });
      source.emit({ topic: 'school', event: 'record-changed', learnerId: 'kid' });
      source.emit({ topic: 'state-gates', kind: 'GateStateChanged', payload: { gateId: 'school.day-complete', subject: { kind: 'learner', id: 'kid' } } });
    });
    act(() => vi.advanceTimersByTime(750)); expect(refresh).toHaveBeenCalledTimes(1);
    act(() => source.emit({ topic: 'state-gates', kind: 'GateStateChanged', payload: { gateId: 'school.day-complete', subject: { kind: 'learner', id: 'other' } } }));
    act(() => vi.advanceTimersByTime(750)); expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('repairs missed events on reconnect and visible, with full cleanup and the latest callback', () => {
    vi.useFakeTimers(); const source = eventSource(); const a = vi.fn(); const b = vi.fn();
    const { rerender, unmount } = renderHook(({ refresh }) => useSchoolInvalidation({ refresh, events: source }), { initialProps: { refresh: a } });
    expect(a).not.toHaveBeenCalled();
    rerender({ refresh: b });
    act(() => { source.status(false); source.status(true); source.status(true); });
    act(() => vi.advanceTimersByTime(750)); expect(b).toHaveBeenCalledTimes(1); expect(a).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(750)); expect(b).toHaveBeenCalledTimes(2);
    act(() => source.emit({ topic: 'school', event: 'coins-changed' }));
    unmount();
    expect(source.counts).toEqual([0, 0]); expect(vi.getTimerCount()).toBe(0);
    act(() => { source.status(false); source.status(true); document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(800); });
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('disabling drops queued work and all event listeners', () => {
    vi.useFakeTimers(); const source = eventSource(); const refresh = vi.fn();
    const { rerender } = renderHook(({ enabled }) => useSchoolInvalidation({ refresh, enabled, events: source }), { initialProps: { enabled: true } });
    act(() => source.emit({ topic: 'school', event: 'record-changed' }));
    rerender({ enabled: false });
    act(() => vi.advanceTimersByTime(800));
    expect(refresh).not.toHaveBeenCalled(); expect(source.counts).toEqual([0, 0]);
  });
});

it('scopes roster invalidations to its learner ids while allowing household changes', () => {
  vi.useFakeTimers(); const source = eventSource(); const refresh = vi.fn();
  renderHook(() => useSchoolInvalidation({ refresh, learnerIds: ['one', 'two'], topics: ['school', 'state-gates'], events: source }));
  act(() => source.emit({ topic: 'school', event: 'coins-changed', learnerId: 'other' }));
  act(() => vi.advanceTimersByTime(750)); expect(refresh).not.toHaveBeenCalled();
  act(() => source.emit({ topic: 'state-gates', payload: { gateId: 'school.day-complete', subject: { kind: 'learner', id: 'two' } } }));
  act(() => vi.advanceTimersByTime(750)); expect(refresh).toHaveBeenCalledTimes(1);
  act(() => source.emit({ topic: 'school', event: 'record-changed', learnerId: null }));
  act(() => vi.advanceTimersByTime(750)); expect(refresh).toHaveBeenCalledTimes(2);
});
