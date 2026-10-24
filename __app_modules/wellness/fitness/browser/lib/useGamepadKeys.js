import { useEffect, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';

// Standard-mapping gamepad -> menu keys. Edge-triggered: a held button fires
// once. D-pad 12-15, A (0) = Enter, B (1) = Escape.
const BUTTON_KEYS = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 0: 'Enter', 1: 'Escape' };

export function gamepadKeyEdges(previous, pads) {
  const pressed = new Set();
  for (const pad of pads || []) {
    if (!pad?.buttons) continue;
    for (const [index, key] of Object.entries(BUTTON_KEYS)) {
      if (pad.buttons[index]?.pressed) pressed.add(key);
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
    const poll = () => {
      let pads = [];
      try { pads = [...navigator.getGamepads()].filter(Boolean); } catch (_) { pads = []; }
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
