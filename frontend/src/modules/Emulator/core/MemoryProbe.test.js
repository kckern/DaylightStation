import { describe, it, expect, vi } from 'vitest';
import { createMemoryProbe } from './MemoryProbe.js';

// WRAM base 0xC000 -> offset 0; with wramBase=0 the heap index == cpuAddr-0xC000.
const D057 = 0xd057; // offset 0x1057
const OFF_D057 = D057 - 0xc000;

function makeProbe(watches, opts = {}) {
  const heap = new Uint8Array(0x4000);
  const onEvent = vi.fn();
  const probe = createMemoryProbe({
    getHeap: () => heap,
    wramBase: 0,
    system: 'gb',
    watches,
    onEvent,
    ...opts,
  });
  return { probe, heap, onEvent };
}

describe('MemoryProbe edge detection', () => {
  it('fires once on the rising edge of gt:0 and not while it stays true', () => {
    const { probe, heap, onEvent } = makeProbe([
      { id: 'in_battle', addr: D057, size: 1, when: { gt: 0 } },
    ]);

    // value 0 -> predicate false -> no event
    probe.sample();
    expect(onEvent).not.toHaveBeenCalled();

    // value 1 -> rising edge -> fire once
    heap[OFF_D057] = 1;
    probe.sample();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith('in_battle', { value: 1, prevValue: 0 });

    // still 1 -> level, no re-fire
    probe.sample();
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('fires on the first sample when predicate is already true', () => {
    const { probe, heap, onEvent } = makeProbe([
      { id: 'in_battle', addr: D057, size: 1, when: { gt: 0 } },
    ]);
    heap[OFF_D057] = 5;
    probe.sample();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith('in_battle', { value: 5, prevValue: undefined });
  });

  it('changed:true fires whenever the value changes between samples', () => {
    const { probe, heap, onEvent } = makeProbe([
      { id: 'tick', addr: D057, size: 1, when: { changed: true } },
    ]);
    heap[OFF_D057] = 10;
    probe.sample(); // first sample: prevValue undefined, 10 !== undefined -> changed -> fires
    expect(onEvent).toHaveBeenCalledTimes(1);

    probe.sample(); // unchanged -> predicate false -> resets, no fire
    expect(onEvent).toHaveBeenCalledTimes(1);

    heap[OFF_D057] = 11;
    probe.sample(); // changed again -> rising edge -> fire
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenLastCalledWith('tick', { value: 11, prevValue: 10 });
  });
});

describe('MemoryProbe reads', () => {
  it('reads size-2 little-endian', () => {
    const { probe, heap, onEvent } = makeProbe([
      { id: 'hp', addr: D057, size: 2, when: { gt: 0 } },
    ]);
    heap[OFF_D057] = 0x34; // low
    heap[OFF_D057 + 1] = 0x12; // high
    probe.sample();
    expect(onEvent).toHaveBeenCalledWith('hp', { value: 0x1234, prevValue: undefined });
  });

  it('defaults size to 1 when omitted', () => {
    const { probe, heap, onEvent } = makeProbe([
      { id: 'b', addr: D057, when: { equals: 7 } },
    ]);
    heap[OFF_D057] = 7;
    probe.sample();
    expect(onEvent).toHaveBeenCalledWith('b', { value: 7, prevValue: undefined });
  });
});

describe('MemoryProbe bad-watch isolation', () => {
  it('skips a watch whose addr is outside WRAM range without killing the sample', () => {
    const warn = vi.fn();
    const { probe, heap, onEvent } = makeProbe(
      [
        { id: 'bad', addr: 0x8000, size: 1, when: { gt: 0 } }, // out of range -> throws
        { id: 'good', addr: D057, size: 1, when: { gt: 0 } },
      ],
      { logger: { warn, debug: vi.fn() } },
    );
    heap[OFF_D057] = 1;
    expect(() => probe.sample()).not.toThrow();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith('good', { value: 1, prevValue: undefined });
    expect(warn).toHaveBeenCalled();
  });
});

describe('MemoryProbe scheduler', () => {
  it('start drives sample on tick and stop cancels', () => {
    let tickFn = null;
    const scheduler = {
      set: vi.fn((fn) => {
        tickFn = fn;
        return 'handle-1';
      }),
      clear: vi.fn(),
    };
    const { probe, heap, onEvent } = makeProbe(
      [{ id: 'in_battle', addr: D057, size: 1, when: { gt: 0 } }],
      { scheduler, sampleHz: 10 },
    );

    probe.start();
    expect(scheduler.set).toHaveBeenCalledTimes(1);
    // interval period derived from sampleHz
    expect(scheduler.set.mock.calls[0][1]).toBe(100);

    heap[OFF_D057] = 1;
    tickFn(); // simulate a scheduler tick
    expect(onEvent).toHaveBeenCalledTimes(1);

    probe.stop();
    expect(scheduler.clear).toHaveBeenCalledWith('handle-1');
  });
});
