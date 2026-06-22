/**
 * StateMap — turns raw WRAM reads into named semantic states.
 *
 * Each config entry (name → def) is interpreted per its `type`
 * (flag/enum/count/number). On `.sample()` every state is read and, when its
 * interpreted value changes (or on the first sample), `onState(name, detail)`
 * fires so a BindingMatcher can react. `.start()`/`.stop()` drive sampling on
 * an injected scheduler.
 */

import { readValue } from './memoryRead.js';
import { evalPredicate } from './memoryPredicates.js';

const NOOP_LOGGER = { warn() {} };

const DEFAULT_SCHEDULER = {
  set: (fn, ms) => setInterval(fn, ms),
  clear: (id) => clearInterval(id),
};

function popcount(n) {
  let count = 0;
  let v = n >>> 0;
  while (v) {
    v &= v - 1;
    count++;
  }
  return count;
}

/**
 * Read one state's raw value and interpret it per its type.
 * @returns {{ detail: object, value: any }} detail for onState, value for snapshot
 */
function interpret(name, def, heap, wramBase, system) {
  const { type } = def;
  const raw = readValue(heap, wramBase, system, def);

  switch (type) {
    case 'flag': {
      const active = evalPredicate(def.when, raw);
      return { detail: { type: 'flag', active, value: raw }, value: active };
    }
    case 'enum': {
      const values = def.values || {};
      const label = values[raw] ?? 'unknown_' + raw;
      return { detail: { type: 'enum', value: label, raw }, value: label };
    }
    case 'count': {
      const bits = popcount(raw);
      return { detail: { type: 'count', value: bits }, value: bits };
    }
    case 'number':
    default: {
      return { detail: { type: 'number', value: raw }, value: raw };
    }
  }
}

/**
 * @param {object} opts
 * @param {() => Uint8Array} opts.getHeap re-fetched each sample
 * @param {number} opts.wramBase heap index where system RAM begins
 * @param {string} [opts.system='gb']
 * @param {object} opts.states name → state def
 * @param {(name: string, detail: object) => void} opts.onState change callback
 * @param {{set,clear}} [opts.scheduler]
 * @param {number} [opts.sampleHz=10]
 * @param {{warn}} [opts.logger]
 */
export function createStateMap({
  getHeap,
  wramBase,
  system = 'gb',
  states,
  onState,
  scheduler = DEFAULT_SCHEDULER,
  sampleHz = 10,
  logger = NOOP_LOGGER,
}) {
  const prev = new Map(); // name → last interpreted value
  const current = {}; // name → current interpreted value (for getState)
  let timer = null;

  function sample() {
    const heap = getHeap();
    for (const [name, def] of Object.entries(states)) {
      let result;
      try {
        result = interpret(name, def, heap, wramBase, system);
      } catch (err) {
        logger.warn('state-read-failed', { name, error: err.message });
        continue;
      }
      const { detail, value } = result;
      current[name] = value;
      const had = prev.has(name);
      if (!had || prev.get(name) !== value) {
        prev.set(name, value);
        onState && onState(name, detail);
      }
    }
  }

  function start() {
    if (timer != null) return;
    timer = scheduler.set(sample, Math.round(1000 / sampleHz));
  }

  function stop() {
    if (timer == null) return;
    scheduler.clear(timer);
    timer = null;
  }

  function getState() {
    return { ...current };
  }

  return { sample, start, stop, getState };
}
