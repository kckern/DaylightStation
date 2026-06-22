import { describe, it, expect, vi } from 'vitest';
import { createStateMap } from './StateMap.js';

function makeHeap(size = 0x2000) {
  return new Uint8Array(size);
}

describe('createStateMap', () => {
  it('enum: emits initial label, emits on change, dedupes same value', () => {
    const heap = makeHeap();
    const onState = vi.fn();
    const states = {
      battle: { addr: 0xd057, type: 'enum', values: { 0: 'none', 1: 'wild', 2: 'trainer' } },
    };
    const sm = createStateMap({ getHeap: () => heap, wramBase: 0, states, onState });

    // raw 0 (offset 0x1057 already 0) → none
    sm.sample();
    expect(onState).toHaveBeenLastCalledWith('battle', { type: 'enum', value: 'none', raw: 0 });

    heap[0x1057] = 2;
    sm.sample();
    expect(onState).toHaveBeenLastCalledWith('battle', { type: 'enum', value: 'trainer', raw: 2 });

    const callCount = onState.mock.calls.length;
    sm.sample(); // same value → no emit
    expect(onState.mock.calls.length).toBe(callCount);
  });

  it('flag with {lt:10} on a 2-byte LE value transitions correctly', () => {
    const heap = makeHeap();
    const onState = vi.fn();
    const states = {
      hp_low: { addr: 0xd16c, size: 2, type: 'flag', when: { lt: 10 } },
    };
    const sm = createStateMap({ getHeap: () => heap, wramBase: 0, states, onState });
    const off = 0xd16c - 0xc000; // 0x116c

    // value 20 → inactive (first sample emits active:false)
    heap[off] = 20;
    heap[off + 1] = 0;
    sm.sample();
    expect(onState).toHaveBeenLastCalledWith('hp_low', { type: 'flag', active: false, value: 20 });

    // value 5 → active
    heap[off] = 5;
    sm.sample();
    expect(onState).toHaveBeenLastCalledWith('hp_low', { type: 'flag', active: true, value: 5 });

    // value 7 → still active, no re-emit
    const c = onState.mock.calls.length;
    heap[off] = 7;
    sm.sample();
    expect(onState.mock.calls.length).toBe(c);

    // value 50 → inactive again
    heap[off] = 50;
    sm.sample();
    expect(onState).toHaveBeenLastCalledWith('hp_low', { type: 'flag', active: false, value: 50 });
  });

  it('count: emits popcount', () => {
    const heap = makeHeap();
    const onState = vi.fn();
    const states = { badges: { addr: 0xd356, type: 'count' } };
    const sm = createStateMap({ getHeap: () => heap, wramBase: 0, states, onState });
    heap[0xd356 - 0xc000] = 0b00000111; // 3 bits
    sm.sample();
    expect(onState).toHaveBeenLastCalledWith('badges', { type: 'count', value: 3 });
  });

  it('number with size 2: emits decoded value and re-emits on change', () => {
    const heap = makeHeap();
    const onState = vi.fn();
    const states = { money: { addr: 0xd347, size: 2, type: 'number' } };
    const sm = createStateMap({ getHeap: () => heap, wramBase: 0, states, onState });
    const off = 0xd347 - 0xc000;
    heap[off] = 0x34;
    heap[off + 1] = 0x12; // LE → 0x1234
    sm.sample();
    expect(onState).toHaveBeenLastCalledWith('money', { type: 'number', value: 0x1234 });

    heap[off + 1] = 0x13; // → 0x1334
    sm.sample();
    expect(onState).toHaveBeenLastCalledWith('money', { type: 'number', value: 0x1334 });
  });

  it('bad state (addr out of WRAM) is skipped + logged; others still emit', () => {
    const heap = makeHeap();
    const onState = vi.fn();
    const logger = { warn: vi.fn() };
    const states = {
      bad: { addr: 0x0000, type: 'number' }, // out of gb WRAM range
      battle: { addr: 0xd057, type: 'enum', values: { 0: 'none' } },
    };
    const sm = createStateMap({ getHeap: () => heap, wramBase: 0, states, onState, logger });
    sm.sample();
    expect(logger.warn).toHaveBeenCalled();
    expect(onState).toHaveBeenCalledWith('battle', { type: 'enum', value: 'none', raw: 0 });
    // bad never emitted
    expect(onState.mock.calls.find((c) => c[0] === 'bad')).toBeUndefined();
  });

  it('getState() returns current interpreted snapshot', () => {
    const heap = makeHeap();
    const onState = vi.fn();
    const states = {
      battle: { addr: 0xd057, type: 'enum', values: { 0: 'none', 2: 'trainer' } },
      badges: { addr: 0xd356, type: 'count' },
    };
    const sm = createStateMap({ getHeap: () => heap, wramBase: 0, states, onState });
    heap[0xd057 - 0xc000] = 2;
    heap[0xd356 - 0xc000] = 0b11; // 2 bits
    sm.sample();
    expect(sm.getState()).toEqual({ battle: 'trainer', badges: 2 });
  });

  it('start/stop drive sample via injected scheduler', () => {
    const heap = makeHeap();
    const onState = vi.fn();
    let tickFn = null;
    const scheduler = {
      set: vi.fn((fn) => {
        tickFn = fn;
        return 't1';
      }),
      clear: vi.fn(),
    };
    const states = { battle: { addr: 0xd057, type: 'enum', values: { 0: 'none' } } };
    const sm = createStateMap({ getHeap: () => heap, wramBase: 0, states, onState, scheduler, sampleHz: 10 });
    sm.start();
    expect(scheduler.set).toHaveBeenCalledWith(expect.any(Function), 100);
    tickFn();
    expect(onState).toHaveBeenCalledWith('battle', { type: 'enum', value: 'none', raw: 0 });
    sm.stop();
    expect(scheduler.clear).toHaveBeenCalledWith('t1');
  });

  it('re-fetches heap each sample (memory.grow swap)', () => {
    let heap = makeHeap();
    const onState = vi.fn();
    const states = { battle: { addr: 0xd057, type: 'enum', values: { 0: 'none', 1: 'wild' } } };
    const sm = createStateMap({ getHeap: () => heap, wramBase: 0, states, onState });
    sm.sample();
    expect(onState).toHaveBeenLastCalledWith('battle', { type: 'enum', value: 'none', raw: 0 });
    // swap the view
    heap = makeHeap();
    heap[0xd057 - 0xc000] = 1;
    sm.sample();
    expect(onState).toHaveBeenLastCalledWith('battle', { type: 'enum', value: 'wild', raw: 1 });
  });
});
