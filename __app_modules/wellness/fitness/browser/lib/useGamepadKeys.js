import { useEffect, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';

// Standard-mapping gamepad -> menu keys. Edge-triggered: a held button fires
// once. D-pad 12-15, A (0) = Enter, B (1) = Escape. The left stick (axes 0/1)
// also navigates: past half deflection it reads as an arrow. Only axes 0/1,
// because a stick rests at 0 on most pads; triggers and hats differ by pad and
// browser, and one resting at -1 would hold an arrow down forever. A
// non-standard pad can still rest axis 0 or 1 at ±1, which would hold an arrow
// and mask the D-pad's, so an axis counts only after it has been seen within
// ±0.25 of centre in this activation (per pad, `id|index`; see `centred`).
// The hook logs `gamepad-shape` (id, mapping, button and axis counts, resting
// axis values, held buttons) once per pad per page load, so an unfamiliar
// pad's layout is measured, not guessed.
// A button held when the hook turns on does not fire until it is pressed again.
const BUTTON_KEYS = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 0: 'Enter', 1: 'Escape' };
const STICK_THRESHOLD = 0.5;
const CENTRE_BAND = 0.25;

// `axisValues` (first four, rounded) and `pressedButtons` show a resting
// off-centre axis or a stuck button at the moment the pad is first seen.
export function padShape(pad) {
  const buttons = pad?.buttons || [];
  const axes = pad?.axes || [];
  const pressedButtons = [];
  for (let i = 0; i < buttons.length; i++) if (buttons[i]?.pressed) pressedButtons.push(i);
  return {
    id: pad?.id || '',
    mapping: pad?.mapping || '',
    buttons: buttons.length,
    axes: axes.length,
    axisValues: [...axes].slice(0, 4).map((v) => Math.round(v * 100) / 100),
    pressedButtons,
  };
}

/**
 * @param {Set<string>} previous  keys held at the last sample.
 * @param {Array<Gamepad>} pads
 * @param {Map<string, Set<number>>} [centred]  per pad (`id|index`), which of
 *   axes 0/1 have been seen near centre so far. Not mutated.
 * @returns {{ pressed: Set<string>, edges: string[], centred: Map<string, Set<number>> }}
 */
export function gamepadKeyEdges(previous, pads, centred = new Map()) {
  const pressed = new Set();
  const nextCentred = new Map(centred);
  for (const pad of pads || []) {
    if (!pad) continue;
    if (pad.buttons) {
      for (const [index, key] of Object.entries(BUTTON_KEYS)) {
        if (pad.buttons[index]?.pressed) pressed.add(key);
      }
    }
    const padKey = `${pad.id}|${pad.index}`;
    let seen = nextCentred.get(padKey);
    const axes = pad.axes || [];
    for (const axis of [0, 1]) {
      const v = axes[axis];
      if (typeof v === 'number' && Math.abs(v) <= CENTRE_BAND && !seen?.has(axis)) {
        seen = new Set(seen || []);
        seen.add(axis);
        nextCentred.set(padKey, seen);
      }
    }
    const [x, y] = axes;
    if (typeof x === 'number' && seen?.has(0)) {
      if (x <= -STICK_THRESHOLD) pressed.add('ArrowLeft');
      else if (x >= STICK_THRESHOLD) pressed.add('ArrowRight');
    }
    if (typeof y === 'number' && seen?.has(1)) {
      if (y <= -STICK_THRESHOLD) pressed.add('ArrowUp');
      else if (y >= STICK_THRESHOLD) pressed.add('ArrowDown');
    }
  }
  const edges = [...pressed].filter((key) => !previous.has(key));
  return { pressed, edges, centred: nextCentred };
}

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'fitness-gamepad-keys' }));

// Pads whose shape was logged this page load (`id|index`). Module-level, because
// screens such as FitnessShow switch the hook on and off with every video.
const shapesLogged = new Set();

// Polls the Gamepad API only while `active`, one rAF loop, and hands each new
// press to onKey. No gamepad connected = one cheap getGamepads() per frame.
export function useGamepadKeys(active, onKey) {
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return undefined;
    let raf = null;
    let stopped = false;
    // null until the first poll: a button already held when the hook turns on
    // (B that just closed another screen, A that just opened this one) is
    // treated as held, and fires only after a release and a new press.
    let previous = null;
    // Axes 0/1 seen at rest this activation; a fresh activation starts empty.
    let centred = new Map();
    const poll = () => {
      if (stopped) return;
      let pads = [];
      try { pads = [...navigator.getGamepads()].filter(Boolean); } catch (_) { pads = []; }
      for (const pad of pads) {
        const key = `${pad.id}|${pad.index}`;
        if (!shapesLogged.has(key)) { shapesLogged.add(key); logger().info('gamepad-shape', padShape(pad)); }
      }
      const result = gamepadKeyEdges(previous || new Set(), pads, centred);
      const { pressed } = result;
      const edges = previous === null ? [] : result.edges;
      previous = pressed;
      centred = result.centred;
      for (const key of edges) {
        logger().debug('gamepad-key', { key });
        onKeyRef.current?.(key);
      }
      if (stopped) return; // onKey may unmount this screen
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => { stopped = true; if (raf !== null) cancelAnimationFrame(raf); };
  }, [active]);
}
