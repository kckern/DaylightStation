import { useCallback, useEffect, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';

// Steps fuel the stream. A `pressure-mat:step` from the shooter's mat buys
// fuel; a `pressure-mat:stomp` is a step that also drops the bomb when one is
// ready (the mat reports a stomp INSTEAD of a step, never both). Presses are
// queued and the frame loop drains them once per frame.
//
// The engine runs no step on a frame with no elapsed time and would drop that
// frame's presses, so the loop must drain only on a frame it is going to step
// (`elapsedS > 0 ? drain() : EMPTY`). Undrained presses wait here in order.
//
// The mat is the only thing that fires in the kiosk. A gamepad never does:
// children played rounds on one instead of stepping (2026-11-20), so its
// buttons and stick are only watched, and a press is logged as
// `skyline_invaders.input.ignored` (sampled). The keyboard fires only when
// `allowKeys` is set, which the shell does in a dev build alone: the garage's
// Bluetooth remotes and keyboards send keys too.
export const FIRE_KEYS = Object.freeze([' ', 'f', 'F']);
export const BOMB_KEYS = Object.freeze(['b', 'B']);
const PRESS_THRESHOLD = 0.5;
const IGNORED_PER_MINUTE = 6;
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

// A game key, unless it is a browser shortcut or typed into a field.
function keyKind(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target;
  if (target && (TYPING_TAGS.has(target.tagName) || target.isContentEditable)) return null;
  if (FIRE_KEYS.includes(event.key)) return 'step';
  if (BOMB_KEYS.includes(event.key)) return 'stomp';
  return null;
}

/**
 * @param {object} options
 * @param {boolean} options.enabled       listen only while a round is being played
 * @param {string|null} options.matId     the shooter mat's HARDWARE id (matSelection.js)
 * @param {function} options.subscribeToAppEvent  from FitnessContext
 * @param {object} [options.tracker]      createAimTracker(): a mat press holds the cannon's lane for a moment
 * @param {boolean} [options.allowKeys]   Space/F and B fire and bomb (dev builds only; never in the kiosk)
 * @param {function} [options.getGamepads] for tests: the pads to watch (default navigator.getGamepads)
 * @param {function} [options.onPress]    hears every queued press: { kind, source, at, ... }
 * @returns {function} drain() -> { steps, stomps } for the engine's intents; drain.clear() empties the queue
 */
export default function useInvadersFire({ enabled = true, matId = null, subscribeToAppEvent, tracker = null, allowKeys = false, getGamepads, onPress } = {}) {
  const log = useMemo(() => getLogger().child({ component: 'skyline-invaders-fire' }), []);
  const ignored = useCallback((source, data) => {
    log.sampled('skyline_invaders.input.ignored', { source, ...data }, { maxPerMinute: IGNORED_PER_MINUTE, aggregate: true });
  }, [log]);
  const queue = useRef({ steps: [], stomps: [] });
  const live = useRef({});
  live.current = { tracker, onPress };

  const push = useCallback((kind, source, at, extra = {}) => {
    const press = { source, at };
    queue.current[kind === 'stomp' ? 'stomps' : 'steps'].push(press);
    // Stepping throws the arms. A key or a button does not move the player.
    if (source === 'mat') live.current.tracker?.freezeLane?.(undefined, at);
    live.current.onPress?.({ kind, ...press, ...extra });
  }, []);

  // A press from before a pause or a level change never counts afterwards.
  useEffect(() => { queue.current = { steps: [], stomps: [] }; }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!matId || !subscribeToAppEvent) {
      log.warn('skyline_invaders.fire.no_mat', { matId: matId ?? null, hasEventBus: !!subscribeToAppEvent });
      return undefined;
    }
    const wanted = String(matId);
    log.info('skyline_invaders.fire.armed', { matId: wanted });
    const hear = (kind) => (event) => {
      const from = event?.payload?.id ?? event?.source;
      if (from == null || String(from) !== wanted) {
        log.sampled('skyline_invaders.fire.other_mat', { from: from ?? null, matId: wanted }, { maxPerMinute: 6, aggregate: true });
        return;
      }
      push(kind, 'mat', event.timestamp ?? Date.now(), { matId: wanted });
    };
    const stops = [subscribeToAppEvent('pressure-mat:step', hear('step')), subscribeToAppEvent('pressure-mat:stomp', hear('stomp'))];
    return () => stops.forEach((stop) => stop?.());
  }, [enabled, matId, subscribeToAppEvent, push, log]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      const kind = keyKind(event);
      if (!kind) return;
      event.preventDefault();
      // A tapped button keeps focus and Space would press it on keyup in
      // Firefox. Drop the focus so game keys only ever play.
      const target = event.target;
      if (target && target !== document.body && typeof target.blur === 'function') target.blur();
      if (event.repeat) return;
      if (!allowKeys) { ignored('keyboard', { key: event.key, kind }); return; }
      push(kind, 'keyboard', Date.now(), { key: event.key });
    };
    const onKeyUp = (event) => { if (keyKind(event)) event.preventDefault(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [enabled, allowKeys, push, ignored]);

  // A gamepad is watched, never played: a new press of any button or a push of
  // the stick is logged and goes no further. The pause (Start, B) and the exit
  // (Select) are the shell's, and only stop the round.
  useEffect(() => {
    if (!enabled) return undefined;
    const read = getGamepads || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
    const held = new Map();
    let frame = 0;
    const poll = () => {
      let pads = [];
      try { pads = Array.from(read() || []); } catch { pads = []; }
      for (const pad of pads) {
        if (!pad) continue;
        const down = Array.from(pad.buttons || []).map((button) => !!button?.pressed || (button?.value ?? 0) > PRESS_THRESHOLD);
        const stick = Array.from(pad.axes || []).slice(0, 2).some((value) => Math.abs(value || 0) > PRESS_THRESHOLD);
        const prior = held.get(pad.index);
        // What is already down when watching starts is held, not pressed.
        if (prior) {
          const button = down.findIndex((isDown, index) => isDown && !prior.down[index]);
          if (button >= 0) ignored('gamepad', { input: 'button', button, padId: pad.id });
          else if (stick && !prior.stick) ignored('gamepad', { input: 'stick', padId: pad.id });
        }
        held.set(pad.index, { down, stick });
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [enabled, getGamepads, ignored]);

  const drain = useCallback(() => { const presses = queue.current; queue.current = { steps: [], stomps: [] }; return presses; }, []);
  drain.clear = () => { queue.current = { steps: [], stomps: [] }; };
  return drain;
}
