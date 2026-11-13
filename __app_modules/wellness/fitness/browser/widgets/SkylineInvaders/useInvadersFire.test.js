import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), sampled: vi.fn() }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => mockLog }) }));

import useInvadersFire from './useInvadersFire.js';

const bus = () => {
  const listeners = new Map();
  return {
    subscribeToAppEvent: (type, cb) => { listeners.set(type, cb); return () => listeners.delete(type); },
    emit: (type, id, timestamp = 5000) => listeners.get(type)?.({ type, payload: { id, event: 'pressed' }, source: id, timestamp }),
    raw: (type, event) => listeners.get(type)?.(event),
    has: (type) => listeners.has(type),
  };
};
const tracker = () => ({ freezeLane: vi.fn() });
const pad = (pressed = []) => ({ index: 0, id: 'test-pad', buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
function frames() {
  let queue = [];
  vi.stubGlobal('requestAnimationFrame', (cb) => { queue.push(cb); return queue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { queue = []; });
  return () => act(() => { const due = queue; queue = []; due.forEach((cb) => cb(0)); });
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('useInvadersFire', () => {
  it('queues a step from the shooter mat with its press time, and holds the cannon lane for the throw', () => {
    const b = bus(); const aim = tracker(); const onPress = vi.fn();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: 'mat-a1', subscribeToAppEvent: b.subscribeToAppEvent, tracker: aim, onPress }));
    act(() => { b.emit('pressure-mat:step', 'mat-a1', 5000); });
    expect(aim.freezeLane).toHaveBeenCalledWith(undefined, 5000);
    expect(result.current()).toEqual({ steps: [{ source: 'mat', at: 5000 }], stomps: [] });
    expect(result.current()).toEqual({ steps: [], stomps: [] });
    expect(onPress).toHaveBeenCalledWith({ kind: 'step', source: 'mat', at: 5000, matId: 'mat-a1' });
  });
  it('queues a stomp from the shooter mat as a stomp, not a step', () => {
    const b = bus();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: 'mat-a1', subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker() }));
    act(() => { b.emit('pressure-mat:stomp', 'mat-a1', 6000); });
    expect(result.current()).toEqual({ steps: [], stomps: [{ source: 'mat', at: 6000 }] });
  });
  it('keeps presses in order until the frame loop drains them', () => {
    const b = bus();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: 'mat-a1', subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker() }));
    act(() => { b.emit('pressure-mat:step', 'mat-a1', 5000); b.emit('pressure-mat:step', 'mat-a1', 6000); });
    expect(result.current().steps.map((press) => press.at)).toEqual([5000, 6000]);
  });
  it('ignores steps and stomps from other mats', () => {
    const b = bus();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: 'mat-a1', subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker() }));
    act(() => { b.emit('pressure-mat:step', 'mat-b2'); b.emit('pressure-mat:stomp', 'mat-b2'); });
    expect(result.current()).toEqual({ steps: [], stomps: [] });
    expect(mockLog.sampled).toHaveBeenCalledWith('skyline_invaders.fire.other_mat', { from: 'mat-b2', matId: 'mat-a1' }, expect.any(Object));
  });
  it('matches the mat by the event source when the payload has no id, whatever the id type', () => {
    const b = bus();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: '7', subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker() }));
    act(() => { b.raw('pressure-mat:step', { type: 'pressure-mat:step', payload: { event: 'pressed' }, source: 7, timestamp: 5000 }); });
    expect(result.current().steps).toHaveLength(1);
  });
  it('says so when there is no mat to listen to', () => {
    renderHook(() => useInvadersFire({ enabled: true, matId: null, subscribeToAppEvent: bus().subscribeToAppEvent, tracker: tracker() }));
    expect(mockLog.warn).toHaveBeenCalledWith('skyline_invaders.fire.no_mat', { matId: null, hasEventBus: true });
  });
  it('adds fuel from Space or F and drops a bomb from B, not on repeat, not while typing, and does not freeze the lane', () => {
    const aim = tracker();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: null, tracker: aim }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    });
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    input.remove();
    const presses = result.current();
    expect(presses.steps.map((press) => press.source)).toEqual(['keyboard', 'keyboard']);
    expect(presses.stomps.map((press) => press.source)).toEqual(['keyboard']);
    expect(aim.freezeLane).not.toHaveBeenCalled();
  });
  it('adds fuel from gamepad A or RT and drops a bomb from X or Y, on the button edge', () => {
    const run = frames();
    let buttons = [];
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: null, tracker: tracker(), getGamepads: () => [pad(buttons)] }));
    run();                      // first poll: nothing held
    buttons = [0]; run(); run();  // A down, held for two polls
    buttons = []; run();
    buttons = [2]; run();
    buttons = []; run();
    buttons = [7, 3]; run();
    const presses = result.current();
    expect(presses.steps).toHaveLength(2);
    expect(presses.stomps).toHaveLength(2);
    expect(presses.steps[0].source).toBe('gamepad');
  });
  it('a button already held when polling starts does not count', () => {
    const run = frames();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: null, tracker: tracker(), getGamepads: () => [pad([0, 2])] }));
    run(); run();
    expect(result.current()).toEqual({ steps: [], stomps: [] });
  });
  it('drops everything and unsubscribes when disabled', () => {
    const b = bus();
    const { result, rerender } = renderHook(({ enabled }) => useInvadersFire({ enabled, matId: 'mat-a1', subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker() }), { initialProps: { enabled: true } });
    act(() => { b.emit('pressure-mat:step', 'mat-a1'); });
    rerender({ enabled: false });
    expect(result.current()).toEqual({ steps: [], stomps: [] });
    expect(b.has('pressure-mat:step')).toBe(false);
    expect(b.has('pressure-mat:stomp')).toBe(false);
  });
  it('clear() drops queued presses (pause)', () => {
    const b = bus();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: 'mat-a1', subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker() }));
    act(() => { b.emit('pressure-mat:step', 'mat-a1'); b.emit('pressure-mat:stomp', 'mat-a1'); });
    result.current.clear();
    expect(result.current()).toEqual({ steps: [], stomps: [] });
  });
});
