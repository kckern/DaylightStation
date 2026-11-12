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
const tracker = (over = {}) => ({ latched: vi.fn((at) => ({ x: 0.25, perArm: [0.2, 0.8], armsUp: true, at })), sample: () => ({ x: 0.9, perArm: [null, null], armsUp: false }), ...over });

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('useInvadersFire', () => {
  it('queues one shot per step on the shooter mat, with the latched aim and the press time', () => {
    const b = bus(); const aim = tracker(); const onFire = vi.fn();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: 'mat-a1', subscribeToAppEvent: b.subscribeToAppEvent, tracker: aim, getTier: () => 'big', onFire }));
    act(() => { b.emit('pressure-mat:step', 'mat-a1', 5000); });
    expect(aim.latched).toHaveBeenCalledWith(5000);
    expect(result.current()).toEqual([{ aim: 0.25, tier: 'big', armsUp: true, source: 'mat', at: 5000 }]);
    expect(result.current()).toEqual([]);
    expect(onFire).toHaveBeenCalledWith(expect.objectContaining({ source: 'mat', matId: 'mat-a1' }));
  });
  it('keeps presses in order until the frame loop drains them', () => {
    const b = bus();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: 'mat-a1', subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker(), getTier: () => 'small' }));
    act(() => { b.emit('pressure-mat:step', 'mat-a1', 5000); b.emit('pressure-mat:step', 'mat-a1', 6000); });
    expect(result.current().map((shot) => shot.at)).toEqual([5000, 6000]);
  });
  it('ignores other mats, and never listens to stomps', () => {
    const b = bus();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: 'mat-a1', subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker(), getTier: () => 'small' }));
    act(() => { b.emit('pressure-mat:step', 'mat-b2'); });
    expect(result.current()).toEqual([]);
    expect(b.has('pressure-mat:stomp')).toBe(false);
  });
  it('matches the mat by the event source when the payload has no id, whatever the id type', () => {
    const b = bus();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: '7', subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker(), getTier: () => 'small' }));
    act(() => { b.raw('pressure-mat:step', { type: 'pressure-mat:step', payload: { event: 'pressed' }, source: 7, timestamp: 5000 }); });
    expect(result.current()).toHaveLength(1);
  });
  it('gives two aims on a two-cannon level', () => {
    const b = bus();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: 'mat-a1', cannons: 2, subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker(), getTier: () => 'small' }));
    act(() => { b.emit('pressure-mat:step', 'mat-a1'); });
    expect(result.current()[0].aim).toEqual([0.2, 0.8]);
  });
  it('fires both cannons from the one aim when an arm is not visible', () => {
    const b = bus();
    const aim = tracker({ latched: () => ({ x: 0.25, perArm: [0.2, null], armsUp: false }) });
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: 'mat-a1', cannons: 2, subscribeToAppEvent: b.subscribeToAppEvent, tracker: aim, getTier: () => 'small' }));
    act(() => { b.emit('pressure-mat:step', 'mat-a1'); });
    expect(result.current()[0].aim).toBe(0.25);
  });
  it('fires from the keyboard with the current aim, not on repeat, not while typing', () => {
    const b = bus();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: null, subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker(), getTier: () => 'small' }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    });
    input.remove();
    expect(result.current()).toEqual([expect.objectContaining({ aim: 0.9, source: 'keyboard' })]);
  });
  it('keeps Space from pressing a focused button', () => {
    renderHook(() => useInvadersFire({ enabled: true, matId: null, subscribeToAppEvent: bus().subscribeToAppEvent, tracker: tracker(), getTier: () => 'small' }));
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    const down = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    const up = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
    act(() => { button.dispatchEvent(down); button.dispatchEvent(up); });
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(button);
    button.remove();
  });
  it('fires from a gamepad button edge', () => {
    let pressed = false;
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const getGamepads = () => [{ index: 0, id: 'pad', buttons: [{ pressed, value: pressed ? 1 : 0 }] }];
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: null, subscribeToAppEvent: bus().subscribeToAppEvent, tracker: tracker(), getTier: () => 'small', getGamepads }));
    act(() => { frames.shift()(); });       // primes: held state recorded, nothing fired
    pressed = true;
    act(() => { frames.shift()(); });
    act(() => { frames.shift()(); });       // still held: no second shot
    expect(result.current()).toEqual([expect.objectContaining({ source: 'gamepad' })]);
  });
  it('a button already held when polling starts does not fire', () => {
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const getGamepads = () => [{ index: 0, id: 'pad', buttons: [{ pressed: true, value: 1 }] }];
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: null, subscribeToAppEvent: bus().subscribeToAppEvent, tracker: tracker(), getTier: () => 'small', getGamepads }));
    act(() => { frames.shift()(); });
    act(() => { frames.shift()(); });
    expect(result.current()).toEqual([]);
  });
  it('drops everything and unsubscribes when disabled', () => {
    const b = bus();
    const { result, rerender } = renderHook(({ enabled }) => useInvadersFire({ enabled, matId: 'mat-a1', subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker(), getTier: () => 'small' }), { initialProps: { enabled: true } });
    act(() => { b.emit('pressure-mat:step', 'mat-a1'); });
    rerender({ enabled: false });
    expect(result.current()).toEqual([]);
    expect(b.has('pressure-mat:step')).toBe(false);
  });
  it('clear() drops queued presses (pause)', () => {
    const b = bus();
    const { result } = renderHook(() => useInvadersFire({ enabled: true, matId: 'mat-a1', subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker(), getTier: () => 'small' }));
    act(() => { b.emit('pressure-mat:step', 'mat-a1'); });
    result.current.clear();
    expect(result.current()).toEqual([]);
  });
  it('logs what it is listening to, and warns when there is no mat to fire from', () => {
    const b = bus();
    const { rerender } = renderHook(({ matId }) => useInvadersFire({ enabled: true, matId, subscribeToAppEvent: b.subscribeToAppEvent, tracker: tracker(), getTier: () => 'small' }), { initialProps: { matId: 'mat-a1' } });
    expect(mockLog.info).toHaveBeenCalledWith('skyline_invaders.fire.armed', expect.objectContaining({ matId: 'mat-a1' }));
    rerender({ matId: null });
    expect(mockLog.warn).toHaveBeenCalledWith('skyline_invaders.fire.no_mat', expect.any(Object));
  });
});
