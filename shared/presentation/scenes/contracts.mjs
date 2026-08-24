export const PRESENTATION_SCENE_KINDS = Object.freeze({
  TOP_DOWN: 'top-down-scene',
  SIDE_SCROLLER: 'side-scroller-scene',
  FIXED_GRID: 'fixed-grid-scene',
  TEXT: 'text-scene',
});

export const PRESENTATION_ACTIONS = Object.freeze([
  'move.north', 'move.east', 'move.south', 'move.west',
  'action.primary', 'action.secondary', 'menu.open', 'menu.back', 'pause',
]);

/** Small host-facing registry; adapters consume semantic actions, never devices. */
export function createPresentationAdapterRegistry(adapters = {}) {
  const registry = new Map(Object.entries(adapters));
  return Object.freeze({
    register(kind, adapter) {
      if (!Object.values(PRESENTATION_SCENE_KINDS).includes(kind)) throw new Error(`unknown presentation scene kind: ${kind}`);
      if (!adapter?.compile || typeof adapter.compile !== 'function') throw new Error(`presentation adapter ${kind} needs compile()`);
      registry.set(kind, adapter); return this;
    },
    get(kind) { return registry.get(kind) ?? null; },
    compile(catalog, scene) {
      const adapter = registry.get(scene?.kind);
      if (!adapter) throw new Error(`presentation scene kind is declared but not implemented: ${scene?.kind}`);
      return adapter.compile(catalog, scene);
    },
    kinds() { return [...registry.keys()].sort(); },
  });
}

/** Normalize keyboard, touch, gamepad, piano, or host events upstream of games. */
export function presentationAction(action, { phase = 'press', value = 1, source = 'host', timestamp = 0 } = {}) {
  if (!PRESENTATION_ACTIONS.includes(action) && !String(action).startsWith('challenge.')) throw new Error(`unknown presentation action: ${action}`);
  if (!['press', 'release', 'change'].includes(phase)) throw new Error(`invalid presentation action phase: ${phase}`);
  if (!Number.isFinite(value)) throw new Error('presentation action value must be numeric');
  return Object.freeze({ action, phase, value, source, timestamp });
}

/** Challenges are context-owned and report state without coupling presentation to Fitness/Piano/School. */
export function validateChallengeContract(challenge) {
  const errors = [];
  if (!challenge || typeof challenge !== 'object' || Array.isArray(challenge)) return { valid: false, errors: ['challenge must be an object'] };
  if (typeof challenge.id !== 'string' || !challenge.id) errors.push('challenge.id is required');
  if (typeof challenge.start !== 'function') errors.push('challenge.start must be a function');
  if (typeof challenge.handleAction !== 'function') errors.push('challenge.handleAction must be a function');
  if (typeof challenge.snapshot !== 'function') errors.push('challenge.snapshot must be a function');
  if (typeof challenge.dispose !== 'function') errors.push('challenge.dispose must be a function');
  return { valid: errors.length === 0, errors };
}
