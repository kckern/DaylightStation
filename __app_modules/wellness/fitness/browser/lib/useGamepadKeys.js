import { useEffect, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';

// Standard-mapping gamepad -> menu keys. Edge-triggered: a held button fires
// once. D-pad 12-15, A (0) = Enter, B (1) = Escape. The left stick (axes 0/1)
// also navigates: past half deflection it reads as an arrow. Only axes 0/1,
// because a stick rests at 0 on every pad; triggers and hats differ by pad and
// browser, and one resting at -1 would hold an arrow down forever.
// While active, the hook logs `gamepad-shape` (id, mapping, button and axis
// counts) once per pad, so an unfamiliar pad's layout is measured, not guessed.
const BUTTON_KEYS = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 0: 'Enter', 1: 'Escape' };
const STICK_THRESHOLD = 0.5;

export function padShape(pad) {
  return { id: pad?.id || '', mapping: pad?.mapping || '', buttons: pad?.buttons?.length || 0, axes: pad?.axes?.length || 0 };
}

export function gamepadKeyEdges(previous, pads) {
  const pressed = new Set();
  for (const pad of pads || []) {
    if (!pad) continue;
    if (pad.buttons) {
      for (const [index, key] of Object.entries(BUTTON_KEYS)) {
        if (pad.buttons[index]?.pressed) pressed.add(key);
      }
    }
    const [x, y] = pad.axes || [];
    if (typeof x === 'number') {
      if (x <= -STICK_THRESHOLD) pressed.add('ArrowLeft');
      else if (x >= STICK_THRESHOLD) pressed.add('ArrowRight');
    }
    if (typeof y === 'number') {
      if (y <= -STICK_THRESHOLD) pressed.add('ArrowUp');
      else if (y >= STICK_THRESHOLD) pressed.add('ArrowDown');
    }
  }
  const edges = [...pressed].filter((key) => !previous.has(key));
  return { pressed, edges };
}

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'fitness-gamepad-keys' }));

// Polls the Gamepad API only while `active`, one rAF loop, and hands each new
// press to onKey. No gamepad connected = one cheap getGamepads() per frame.
export function useGamepadKeys(active, onKey) {
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return undefined;
    let raf = null;
    let previous = new Set();
    const shapesLogged = new Set();
    const poll = () => {
      let pads = [];
      try { pads = [...navigator.getGamepads()].filter(Boolean); } catch (_) { pads = []; }
      for (const pad of pads) {
        const key = `${pad.id}|${pad.index}`;
        if (!shapesLogged.has(key)) { shapesLogged.add(key); logger().info('gamepad-shape', padShape(pad)); }
      }
      const { pressed, edges } = gamepadKeyEdges(previous, pads);
      previous = pressed;
      for (const key of edges) {
        logger().debug('gamepad-key', { key });
        onKeyRef.current?.(key);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => { if (raf !== null) cancelAnimationFrame(raf); };
  }, [active]);
}
