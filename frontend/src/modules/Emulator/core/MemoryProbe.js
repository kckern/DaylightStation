/**
 * MemoryProbe — poll-and-detect over a calibrated WRAM base.
 *
 * Once WramCalibrator has located `wramBase` in HEAPU8, this samples a set of
 * config-driven watches purely by reading WASM memory. Each watch evaluates a
 * predicate (memoryPredicates.evalPredicate); `onEvent` fires only on the
 * RISING EDGE (false->true), not every tick while the predicate holds true.
 *
 * All I/O is injected for unit testing with NO real emulator.
 */

import { evalPredicate } from './memoryPredicates.js';
import { toRamOffset } from './addressMap.js';

const DEFAULT_SCHEDULER = {
  set: (fn, ms) => setInterval(fn, ms),
  clear: (handle) => clearInterval(handle),
};

/**
 * @param {object} deps
 * @param {()=>Uint8Array} deps.getHeap re-fetch the live HEAPU8 every sample
 * @param {number} deps.wramBase heap index where WRAM offset 0 lives
 * @param {string} [deps.system='gb']
 * @param {Array<{id:string,addr:number,size?:number,when:object}>} deps.watches
 * @param {(id:string, detail:{value:number,prevValue:number})=>void} deps.onEvent
 * @param {number} [deps.sampleHz=10]
 * @param {{set:Function,clear:Function}} [deps.scheduler]
 * @param {{warn?:Function,debug?:Function}} [deps.logger]
 */
export function createMemoryProbe({
  getHeap,
  wramBase,
  system = 'gb',
  watches = [],
  onEvent,
  sampleHz = 10,
  scheduler = DEFAULT_SCHEDULER,
  logger,
} = {}) {
  const warn = logger && typeof logger.warn === 'function'
    ? logger.warn.bind(logger)
    : () => {};

  // Per-watch state: previous raw value + previous predicate state (edge mem).
  // prevState defaults to false so an initial true predicate fires once.
  const state = new Map();
  for (const w of watches) {
    state.set(w, { prevValue: undefined, prevPredicate: false });
  }

  let handle = null;

  function readValue(heap, addr, size) {
    const offset = toRamOffset(system, addr); // throws for bad addr
    const base = wramBase + offset;
    let value = 0;
    for (let i = 0; i < size; i++) {
      value |= heap[base + i] << (8 * i);
    }
    // Coerce to unsigned (>>> 0) so multi-byte high bits don't go negative.
    return value >>> 0;
  }

  function sample() {
    const heap = getHeap();
    for (const w of watches) {
      const s = state.get(w);
      const size = w.size ?? 1;
      let value;
      try {
        value = readValue(heap, w.addr, size);
      } catch (err) {
        warn('memory-probe-watch-skip', { id: w.id, addr: w.addr, error: err.message });
        continue;
      }

      const predicate = evalPredicate(w.when, value, s.prevValue);
      if (predicate && !s.prevPredicate) {
        // Rising edge.
        onEvent(w.id, { value, prevValue: s.prevValue });
      }
      s.prevPredicate = predicate;
      s.prevValue = value;
    }
  }

  function start() {
    if (handle !== null) return;
    const periodMs = Math.round(1000 / sampleHz);
    handle = scheduler.set(sample, periodMs);
  }

  function stop() {
    if (handle === null) return;
    scheduler.clear(handle);
    handle = null;
  }

  return { sample, start, stop };
}
