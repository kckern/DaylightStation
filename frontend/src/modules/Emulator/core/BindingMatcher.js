/**
 * BindingMatcher — maps semantic state-change events to action dispatch.
 *
 * Each binding is `{ on, do }`. `on` is a tiny expression (see parseOn) over a
 * single named state; when a matching state-change arrives via
 * `.onStateChange(name, detail)`, every `[action, payload]` in `do` is
 * dispatched through the corresponding `handlers[action]`. Dispatch is
 * tolerant: unknown actions route to `handlers.log` and nothing throws.
 */

const NOOP_LOGGER = { warn() {} };

/**
 * Parse an `on` expression into a predicate descriptor.
 *   "name"          → { state, kind:'truthy' }   (flag active / present)
 *   "!name"         → { state, kind:'falsy' }     (flag cleared)
 *   "name == value" → { state, kind:'eq', value } (enum label / number equals)
 * Whitespace-tolerant.
 * @param {string} on
 * @returns {{state:string, kind:string, value?:string}}
 */
export function parseOn(on) {
  const expr = String(on).trim();

  const eqMatch = expr.match(/^(.+?)\s*==\s*(.+)$/);
  if (eqMatch) {
    return { state: eqMatch[1].trim(), kind: 'eq', value: eqMatch[2].trim() };
  }

  if (expr.startsWith('!')) {
    return { state: expr.slice(1).trim(), kind: 'falsy' };
  }

  return { state: expr, kind: 'truthy' };
}

/**
 * Does a parsed descriptor match the given detail?
 */
function matches(desc, detail) {
  switch (desc.kind) {
    case 'truthy':
      return detail.active === true;
    case 'falsy':
      return detail.active === false;
    case 'eq':
      return String(detail.value).toLowerCase() === String(desc.value).toLowerCase();
    default:
      return false;
  }
}

/**
 * @param {object} opts
 * @param {Array<{on:string, do:object}>} opts.bindings
 * @param {Record<string, Function>} opts.handlers action name → fn
 * @param {{warn}} [opts.logger]
 */
export function createBindingMatcher({ bindings = [], handlers = {}, logger = NOOP_LOGGER }) {
  // Pre-parse each binding's `on` once.
  const parsed = bindings.map((b) => ({ ...b, desc: parseOn(b.on) }));

  function dispatch(action, payload, context) {
    const handler = handlers[action];
    if (typeof handler === 'function') {
      try {
        handler(payload, context);
      } catch (err) {
        logger.warn('binding-handler-failed', { action, error: err && err.message });
      }
      return;
    }
    // Unknown action — route to log handler if present; never throw.
    if (typeof handlers.log === 'function') {
      handlers.log({ unknownAction: action, payload });
    }
  }

  function onStateChange(name, detail) {
    for (const binding of parsed) {
      if (binding.desc.state !== name) continue;
      if (!matches(binding.desc, detail)) continue;
      const actions = binding.do || {};
      const context = { state: name, detail };
      for (const [action, payload] of Object.entries(actions)) {
        dispatch(action, payload, context);
      }
    }
  }

  /**
   * Convenience: wire a stateMap's onState to this matcher. StateMap takes
   * onState at construction, so this only applies if the map exposes a setter;
   * otherwise the caller wires onStateChange directly (which is fine).
   */
  function bind(stateMap) {
    if (stateMap && typeof stateMap.setOnState === 'function') {
      stateMap.setOnState(onStateChange);
    }
    return onStateChange;
  }

  return { onStateChange, bind, parseOn };
}

export default createBindingMatcher;
