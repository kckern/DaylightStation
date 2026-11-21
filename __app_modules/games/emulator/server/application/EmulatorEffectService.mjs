/**
 * EmulatorEffectService — runs the household effects a game's state can call for.
 *
 * A game sidecar binds a memory state to an effect id
 * (`{ on: underground, effect: underground_lights }`). The browser reports
 * `enter` / `exit` for that id; this service looks the id up in the effect
 * registry (media/emulation/effects.yml) and carries it out in Home Assistant.
 * The browser never names an entity or a service, so a page cannot make an
 * arbitrary Home Assistant call: an id that is not in the registry is refused.
 *
 * Registry entry:
 *
 *   underground_lights:
 *     snapshot: [light.garage_light_switch, light.garage_ceiling_led_strip]
 *     hold_zone_lighting: true   # fitness zone colors stand down meanwhile
 *     max_seconds: 600           # safety net: exit even if no exit arrives
 *     enter:
 *       - service: light.turn_off
 *         entity_id: light.garage_light_switch
 *       - scene: scene.garage_led_blue
 *     exit: []                   # the snapshot is restored after these
 *
 * Each effect is a two-state machine (entered / exited). Requests set the
 * DESIRED phase; transitions are applied no faster than `min_interval_ms`
 * (default 3 s) because rapid bursts wedge the garage strips' Zigbee radios.
 * A request that arrives inside that window is coalesced: Mario dipping into a
 * pipe and straight back out inside 3 s changes nothing.
 */

const DEFAULT_MIN_INTERVAL_MS = 3000;
const DEFAULT_MAX_SECONDS = 600;
const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const ENTITY = /^[a-z_]+\.[a-zA-Z0-9_]+$/;
const NOOP_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };

/** Validate one step; returns a normalized step or null. */
function normalizeStep(step) {
  if (!step || typeof step !== 'object') return null;
  if (typeof step.scene === 'string' && ENTITY.test(step.scene) && step.scene.startsWith('scene.')) {
    return { kind: 'scene', entity_id: step.scene };
  }
  if (typeof step.script === 'string' && ENTITY.test(step.script) && step.script.startsWith('script.')) {
    return { kind: 'script', entity_id: step.script, variables: step.variables ?? null };
  }
  if (typeof step.service === 'string' && ENTITY.test(step.service)) {
    const [domain, service] = step.service.split('.');
    const entityIds = [].concat(step.entity_id ?? []);
    if (!entityIds.length || !entityIds.every((e) => typeof e === 'string' && ENTITY.test(e))) return null;
    return { kind: 'service', domain, service, data: { ...(step.data ?? {}), entity_id: entityIds.length === 1 ? entityIds[0] : entityIds } };
  }
  return null;
}

/**
 * Normalize the registry YAML. Invalid effects and steps are dropped with a
 * warning so a typo never runs half an effect.
 * @returns {{ minIntervalMs:number, effects: Map<string, object> }}
 */
export function normalizeEffectRegistry(raw, logger = NOOP_LOGGER) {
  const effects = new Map();
  const minIntervalMs = Number.isFinite(raw?.min_interval_ms) && raw.min_interval_ms >= 0
    ? raw.min_interval_ms : DEFAULT_MIN_INTERVAL_MS;
  for (const [id, def] of Object.entries(raw?.effects ?? {})) {
    if (!ID.test(id) || !def || typeof def !== 'object') {
      logger.warn('emulator.effects.invalid', { effect: id, reason: 'bad-id-or-shape' });
      continue;
    }
    const steps = {};
    let bad = false;
    for (const phase of ['enter', 'exit']) {
      const list = def[phase] ?? [];
      if (!Array.isArray(list)) { bad = true; break; }
      steps[phase] = list.map(normalizeStep);
      if (steps[phase].some((s) => s == null)) { bad = true; break; }
    }
    const snapshot = [].concat(def.snapshot ?? []);
    if (!snapshot.every((e) => typeof e === 'string' && ENTITY.test(e))) bad = true;
    if (bad) {
      logger.warn('emulator.effects.invalid', { effect: id, reason: 'bad-step-or-snapshot' });
      continue;
    }
    effects.set(id, {
      id,
      label: typeof def.label === 'string' ? def.label : id,
      enter: steps.enter,
      exit: steps.exit,
      snapshot,
      holdZoneLighting: def.hold_zone_lighting === true,
      maxMs: (Number.isFinite(def.max_seconds) && def.max_seconds > 0 ? def.max_seconds : DEFAULT_MAX_SECONDS) * 1000,
    });
  }
  return { minIntervalMs, effects };
}

export class EmulatorEffectService {
  #readRegistry;
  #gateway;
  #lightingHold;
  #logger;
  #now;
  #setTimer;
  #clearTimer;
  /** effect id → { applied, desired, busy, lastAt, waitTimer, ttlTimer, game } */
  #state = new Map();

  /**
   * @param {object} deps
   * @param {() => object|null} deps.readRegistry parsed effects.yml (read per request: edits apply live)
   * @param {object|null} deps.haGateway { callService(domain, service, data) }
   * @param {object|null} [deps.lightingHold] { hold(source), release(source) } — the fitness zone LED controller
   * @param {object} [deps.logger]
   * @param {() => number} [deps.now]
   * @param {(fn, ms) => any} deps.setTimer one-shot timer (from composition)
   * @param {(handle) => void} deps.clearTimer
   */
  constructor({ readRegistry, haGateway, lightingHold = null, logger = NOOP_LOGGER,
    now = () => Date.now(), setTimer, clearTimer } = {}) {
    if (typeof readRegistry !== 'function') throw new Error('EmulatorEffectService requires readRegistry');
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
      throw new Error('EmulatorEffectService requires setTimer and clearTimer');
    }
    this.#readRegistry = readRegistry;
    this.#gateway = haGateway ?? null;
    this.#lightingHold = lightingHold;
    this.#logger = logger;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  #registry() {
    let raw = null;
    try { raw = this.#readRegistry(); } catch (err) {
      this.#logger.warn('emulator.effects.registry_unreadable', { error: err?.message });
    }
    return normalizeEffectRegistry(raw, this.#logger);
  }

  #slot(id) {
    let s = this.#state.get(id);
    if (!s) {
      s = { applied: 'exit', desired: 'exit', busy: false, lastAt: -Infinity, waitTimer: null, ttlTimer: null, game: null };
      this.#state.set(id, s);
    }
    return s;
  }

  /**
   * Ask for an effect to be entered or exited.
   * @returns {{ ok:boolean, status?:string, code?:string, error?:string }}
   */
  request(effectId, phase, { game = null, reason = null } = {}) {
    if (!ID.test(String(effectId)) || (phase !== 'enter' && phase !== 'exit')) {
      return { ok: false, code: 'invalid_request', error: 'effect id and phase (enter|exit) required' };
    }
    const { effects, minIntervalMs } = this.#registry();
    const effect = effects.get(effectId);
    if (!effect) {
      this.#logger.warn('emulator.effects.unknown', { effect: effectId, phase, game });
      return { ok: false, code: 'unknown_effect', error: `no effect '${effectId}' in effects.yml` };
    }
    if (!this.#gateway?.callService) {
      this.#logger.warn('emulator.effects.no_gateway', { effect: effectId, phase });
      return { ok: false, code: 'unavailable', error: 'Home Assistant is not configured' };
    }
    const s = this.#slot(effectId);
    s.desired = phase;
    if (game) s.game = game;
    this.#logger.info('emulator.effects.requested', { effect: effectId, phase, game, reason, applied: s.applied });
    if (s.desired === s.applied && !s.busy) return { ok: true, status: 'unchanged' };
    const status = this.#pump(effectId, effect, minIntervalMs);
    return { ok: true, status };
  }

  /** Apply the desired phase when allowed; returns 'applying' | 'queued' | 'unchanged'. */
  #pump(id, effect, minIntervalMs) {
    const s = this.#slot(id);
    if (s.busy) return 'queued';
    if (s.desired === s.applied) return 'unchanged';
    const wait = s.lastAt + minIntervalMs - this.#now();
    if (wait > 0) {
      if (s.waitTimer == null) {
        s.waitTimer = this.#setTimer(() => {
          s.waitTimer = null;
          const fresh = this.#registry();
          this.#pump(id, fresh.effects.get(id) ?? effect, fresh.minIntervalMs);
        }, wait);
      }
      return 'queued';
    }
    const phase = s.desired;
    s.busy = true;
    this.#apply(effect, phase, s)
      .catch((err) => this.#logger.error('emulator.effects.apply_failed', { effect: id, phase, error: err?.message }))
      .finally(() => {
        s.busy = false;
        s.applied = phase;
        s.lastAt = this.#now();
        if (s.desired !== s.applied) this.#pump(id, effect, minIntervalMs);
      });
    return 'applying';
  }

  async #call(domain, service, data, ctx) {
    const res = await this.#gateway.callService(domain, service, data);
    if (res && res.ok === false) {
      this.#logger.warn('emulator.effects.step_failed', { ...ctx, domain, service, error: res.error });
    }
    return res;
  }

  async #apply(effect, phase, s) {
    const ctx = { effect: effect.id, phase, game: s.game };
    const holdSource = `arcade:${effect.id}`;
    const restoreScene = `arcade_restore_${effect.id}`;
    const started = this.#now();

    if (phase === 'enter') {
      if (effect.holdZoneLighting) this.#lightingHold?.hold?.(holdSource);
      if (effect.snapshot.length) {
        await this.#call('scene', 'create', { scene_id: restoreScene, snapshot_entities: effect.snapshot }, ctx);
      }
      await this.#runSteps(effect.enter, ctx);
      if (s.ttlTimer != null) this.#clearTimer(s.ttlTimer);
      s.ttlTimer = this.#setTimer(() => {
        s.ttlTimer = null;
        this.#logger.warn('emulator.effects.max_duration', { ...ctx, maxMs: effect.maxMs });
        this.request(effect.id, 'exit', { game: s.game, reason: 'max-duration' });
      }, effect.maxMs);
    } else {
      if (s.ttlTimer != null) { this.#clearTimer(s.ttlTimer); s.ttlTimer = null; }
      await this.#runSteps(effect.exit, ctx);
      if (effect.snapshot.length) {
        await this.#call('scene', 'turn_on', { entity_id: `scene.${restoreScene}` }, ctx);
      }
      if (effect.holdZoneLighting) this.#lightingHold?.release?.(holdSource);
    }
    this.#logger.info('emulator.effects.applied', { ...ctx, ms: this.#now() - started });
  }

  async #runSteps(steps, ctx) {
    for (const step of steps) {
      if (step.kind === 'scene') await this.#call('scene', 'turn_on', { entity_id: step.entity_id }, ctx);
      else if (step.kind === 'script') {
        await this.#call('script', 'turn_on', { entity_id: step.entity_id, ...(step.variables ? { variables: step.variables } : {}) }, ctx);
      } else await this.#call(step.domain, step.service, step.data, ctx);
    }
  }

  /** Current phase of every effect that has been touched (for diagnostics). */
  getStatus() {
    return Object.fromEntries([...this.#state].map(([id, s]) => [id, { applied: s.applied, desired: s.desired, game: s.game }]));
  }
}

export default EmulatorEffectService;
