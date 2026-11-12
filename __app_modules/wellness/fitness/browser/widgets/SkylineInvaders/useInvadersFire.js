import { useCallback, useEffect, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';

// One mat press = one shot. Presses are queued and the frame loop drains them
// once per frame. Only `pressure-mat:step` from the shooter's mat counts: a
// stomp never also emits a step, and stomps do not fire.
//
// The engine runs no step on a frame with no elapsed time and would drop that
// frame's presses, so the loop must drain only on a frame it is going to step
// (`elapsedS > 0 ? drain() : []`). Undrained presses wait here in order.
export const FIRE_BUTTONS = Object.freeze([0, 7]);      // A / RT, as Skyline's laser
export const FIRE_KEYS = Object.freeze([' ', 'f', 'F']);
const TRIGGER_THRESHOLD = 0.5;
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

// A fire key, unless it is a browser shortcut or typed into a field.
function isFireKey(event) {
  if (!FIRE_KEYS.includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target;
  return !(target && (TYPING_TAGS.has(target.tagName) || target.isContentEditable));
}

/**
 * @param {object} options
 * @param {boolean} options.enabled       listen only while a round is being played
 * @param {string|null} options.matId     the shooter mat's HARDWARE id (matSelection.js)
 * @param {number} options.cannons        2 on a two-cannon level: a shot carries one aim per arm
 * @param {function} options.subscribeToAppEvent  from FitnessContext
 * @param {object} options.tracker        createAimTracker(): `latched(atMs)` and `sample()`
 * @param {function} options.getTier      () => 'small' | 'big' | 'spread' | 'nuke', read at the press
 * @param {function} [options.onFire]     hears every queued press, with where it came from
 * @returns {function} drain() -> the engine's `intents.fire` list; drain.clear() empties the queue
 */
export default function useInvadersFire({ enabled = true, matId = null, cannons = 1, subscribeToAppEvent, tracker, getTier, getGamepads, onFire } = {}) {
  const log = useMemo(() => getLogger().child({ component: 'skyline-invaders-fire' }), []);
  const queue = useRef([]);
  const live = useRef({});
  live.current = { tracker, getTier, onFire, cannons };

  // `latched`: a mat press throws the arms, so it fires with the aim from just
  // before it. A key or a button does not move the player.
  const push = useCallback((source, at, latched, extra = {}) => {
    const { tracker: aim, getTier: tier, onFire: heard, cannons: count } = live.current;
    if (!aim) return;
    const read = latched ? aim.latched(at) : aim.sample();
    const bothArms = count === 2 && Array.isArray(read.perArm) && read.perArm.length === 2 && read.perArm.every((value) => value != null);
    const shot = { aim: bothArms ? read.perArm : read.x, tier: tier?.() || 'small', armsUp: !!read.armsUp, source, at };
    queue.current.push(shot);
    heard?.({ ...shot, ...extra });
  }, []);

  // A press from before a pause or a level change never fires afterwards.
  useEffect(() => { queue.current = []; }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!matId || !subscribeToAppEvent) {
      log.warn('skyline_invaders.fire.no_mat', { matId: matId ?? null, hasEventBus: !!subscribeToAppEvent });
      return undefined;
    }
    const wanted = String(matId);
    log.info('skyline_invaders.fire.armed', { matId: wanted, cannons });
    return subscribeToAppEvent('pressure-mat:step', (event) => {
      const from = event?.payload?.id ?? event?.source;
      if (from == null || String(from) !== wanted) {
        log.sampled('skyline_invaders.fire.other_mat', { from: from ?? null, matId: wanted }, { maxPerMinute: 6, aggregate: true });
        return;
      }
      push('mat', event.timestamp ?? Date.now(), true, { matId: wanted });
    });
  }, [enabled, matId, cannons, subscribeToAppEvent, push, log]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      if (!isFireKey(event)) return;
      event.preventDefault();
      // A tapped button keeps focus and Space would press it on keyup in
      // Firefox. Drop the focus so fire keys only ever fire.
      const target = event.target;
      if (target && target !== document.body && typeof target.blur === 'function') target.blur();
      if (event.repeat) return;
      push('keyboard', Date.now(), false, { key: event.key });
    };
    const onKeyUp = (event) => { if (isFireKey(event)) event.preventDefault(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [enabled, push]);

  useEffect(() => {
    if (!enabled) return undefined;
    const read = getGamepads || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
    const held = new Map();
    const seen = new Set();
    let frame = 0;
    const poll = () => {
      for (const pad of Array.from(read() || [])) {
        if (!pad) continue;
        // A button already down when polling starts is held, not pressed.
        const primed = seen.has(pad.index);
        seen.add(pad.index);
        const button = FIRE_BUTTONS.find((index) => pad.buttons?.[index]?.pressed || pad.buttons?.[index]?.value > TRIGGER_THRESHOLD);
        const down = button !== undefined;
        if (primed && down && !held.get(pad.index)) push('gamepad', Date.now(), false, { button, padId: pad.id });
        held.set(pad.index, down);
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [enabled, getGamepads, push]);

  const drain = useCallback(() => { const shots = queue.current; queue.current = []; return shots; }, []);
  drain.clear = () => { queue.current = []; };
  return drain;
}
