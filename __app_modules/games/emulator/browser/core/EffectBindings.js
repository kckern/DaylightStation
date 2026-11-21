/**
 * EffectBindings — scoped effects that last as long as a game state holds.
 *
 * A binding `{ on: 'underground', effect: 'underground_lights' }` ENTERS its
 * effect when the `on` expression starts matching and EXITS it when the
 * expression stops matching, or when the session ends (`exitAll`). So the
 * garage goes dark when Mario drops into a pipe room and comes back up when he
 * climbs out, or when the game is closed while he is still down there.
 *
 * `on` uses the same grammar as BindingMatcher (`name`, `!name`,
 * `name == value`). The effect itself is only an id: what it does lives in the
 * household effect registry on the server (media/emulation/effects.yml).
 *
 * Bindings without `effect` are ignored here; BindingMatcher handles `do:`.
 */

import { parseOn, matches } from './BindingMatcher.js';

const NOOP_LOGGER = { debug() {}, info() {}, warn() {} };

/**
 * @param {object} opts
 * @param {Array<{on:string, effect?:string}>} opts.bindings
 * @param {(effectId:string, phase:'enter'|'exit', context:object)=>void} opts.onEffect
 * @param {object} [opts.logger]
 */
export function createEffectBindings({ bindings = [], onEffect, logger = NOOP_LOGGER } = {}) {
  const parsed = (Array.isArray(bindings) ? bindings : [])
    .filter((b) => b && typeof b.effect === 'string' && b.effect && typeof b.on === 'string')
    .map((b) => ({ effect: b.effect, on: b.on, desc: parseOn(b.on) }));
  const active = new Set(); // indexes into parsed

  function emit(i, phase, context) {
    const b = parsed[i];
    logger.info('emulator.effect.' + phase, { effect: b.effect, on: b.on, state: context.state, reason: context.reason });
    try {
      onEffect?.(b.effect, phase, context);
    } catch (err) {
      logger.warn('emulator.effect.handler-failed', { effect: b.effect, phase, error: err?.message });
    }
  }

  function onStateChange(name, detail) {
    parsed.forEach((b, i) => {
      if (b.desc.state !== name) return;
      const now = matches(b.desc, detail);
      if (now && !active.has(i)) {
        active.add(i);
        emit(i, 'enter', { state: name, detail, reason: 'state' });
      } else if (!now && active.has(i)) {
        active.delete(i);
        emit(i, 'exit', { state: name, detail, reason: 'state' });
      }
    });
  }

  /** Exit every active effect (session stop / unmount). */
  function exitAll(reason = 'session-end') {
    for (const i of [...active]) {
      active.delete(i);
      emit(i, 'exit', { state: parsed[i].desc.state, reason });
    }
  }

  return {
    onStateChange,
    exitAll,
    getActive: () => [...active].map((i) => parsed[i].effect),
    get size() { return parsed.length; },
  };
}

export default createEffectBindings;
