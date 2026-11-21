/**
 * gameSidecar — a game's memory map and bindings, kept next to its ROM.
 *
 * `gb/roms/SuperMarioLand.gb` → `gb/roms/SuperMarioLand.yml`, unless the
 * manifest entry names another file with `map:`. The sidecar holds:
 *
 *   states:    game knowledge — named states read from memory (addr/type/when/
 *              values/hold). The browser's StateMap samples these.
 *   bindings:  household reactions — `{ on, do }` one-shot actions and
 *              `{ on, effect }` scoped effects that enter and exit with a state.
 *   calibration.scratch: WRAM addresses the browser may ping (32 bytes, a few
 *              frames) to locate WRAM when the core has no memory export. Only
 *              needed when the default page is ambiguous for this game.
 *   calibration.cheat: false — never write into this game to find its RAM
 *              (no safe 32 bytes are known, e.g. the default page is its stack
 *              or audio state). Only a protected core (a saved game) reads it.
 *
 * The console manifest (gameboy.yml) only lists games; per-game memory maps
 * never live there. Everything here is validated before it reaches a browser:
 * a malformed state or binding is dropped with a warning, never half-applied.
 */

const STATE_TYPES = new Set(['flag', 'enum', 'count', 'number']);
const EFFECT_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/** Sidecar path relative to the system folder, or null when there is no ROM. */
export function sidecarPath(game) {
  if (typeof game?.map === 'string' && game.map.trim()) return game.map.trim();
  if (typeof game?.rom !== 'string' || !game.rom) return null;
  const dot = game.rom.lastIndexOf('.');
  const slash = game.rom.lastIndexOf('/');
  const base = dot > slash ? game.rom.slice(0, dot) : game.rom;
  return `${base}.yml`;
}

const isUint = (v) => Number.isInteger(v) && v >= 0;

function normalizeState(name, def, warn) {
  if (!def || typeof def !== 'object') return warn('not-an-object');
  if (!isUint(def.addr)) return warn('addr-must-be-a-number');
  const type = def.type ?? 'number';
  if (!STATE_TYPES.has(type)) return warn('unknown-type');
  if (def.size != null && !(Number.isInteger(def.size) && def.size >= 1 && def.size <= 4)) return warn('size-out-of-range');
  if (type === 'flag' && (!def.when || typeof def.when !== 'object')) return warn('flag-needs-when');
  if (def.hold != null && !(Array.isArray(def.hold) && def.hold.every(isUint))) return warn('hold-must-be-numbers');
  const out = { addr: def.addr, type };
  for (const key of ['size', 'when', 'values', 'hold', 'endian', 'decode']) {
    if (def[key] != null) out[key] = def[key];
  }
  return out;
}

function bindingState(on) {
  const expr = String(on).trim();
  const eq = expr.match(/^(.+?)\s*==\s*(.+)$/);
  const name = eq ? eq[1] : expr.replace(/^!/, '');
  return name.trim();
}

/**
 * @param {object|null} raw parsed sidecar YAML
 * @param {{ system:string, gameId:string, file:string, logger?:object }} ctx
 * @returns {{ states: object|null, bindings: object[]|null, calibration: object|null }}
 */
export function normalizeSidecar(raw, { system, gameId, file, logger } = {}) {
  if (!raw || typeof raw !== 'object') return { states: null, bindings: null, calibration: null };
  const at = { system, game: gameId, file };

  const states = {};
  for (const [name, def] of Object.entries(raw.states ?? {})) {
    const out = normalizeState(name, def, (reason) => {
      logger?.warn?.('emulator.sidecar.state_invalid', { ...at, state: name, reason });
      return null;
    });
    if (out) states[name] = out;
  }

  const bindings = [];
  for (const [i, b] of (Array.isArray(raw.bindings) ? raw.bindings : []).entries()) {
    const reject = (reason) => logger?.warn?.('emulator.sidecar.binding_invalid', { ...at, index: i, on: b?.on, reason });
    if (!b || typeof b.on !== 'string' || !b.on.trim()) { reject('missing-on'); continue; }
    if (!(bindingState(b.on) in states)) { reject('unknown-state'); continue; }
    const hasDo = b.do && typeof b.do === 'object';
    const hasEffect = typeof b.effect === 'string';
    if (hasEffect && !EFFECT_ID.test(b.effect)) { reject('bad-effect-id'); continue; }
    if (!hasDo && !hasEffect) { reject('needs-do-or-effect'); continue; }
    bindings.push({ on: b.on.trim(), ...(hasDo ? { do: b.do } : {}), ...(hasEffect ? { effect: b.effect } : {}) });
  }

  // Ping addresses: whole 32-byte signature must fit in Game Boy WRAM.
  let calibration = null;
  const scratch = raw.calibration?.scratch;
  if (scratch != null) {
    const ok = Array.isArray(scratch) && scratch.length > 0
      && scratch.every((a) => isUint(a) && a >= 0xC000 && a + 32 <= 0xE000);
    if (ok) calibration = { scratch: [...scratch] };
    else logger?.warn?.('emulator.sidecar.calibration_invalid', { ...at, scratch });
  }
  if (raw.calibration?.cheat === false) calibration = { ...(calibration ?? {}), cheat: false };

  const hasStates = Object.keys(states).length > 0;
  return {
    states: hasStates ? states : null,
    bindings: hasStates && bindings.length ? bindings : null,
    calibration: hasStates ? calibration : null,
  };
}
