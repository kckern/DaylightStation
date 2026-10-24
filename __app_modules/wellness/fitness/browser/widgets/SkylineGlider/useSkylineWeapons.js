import { useCallback, useEffect, useRef } from 'react';

// Fire buttons for flight. Presses are edge-detected and queued; the flight
// loop drains the queue once per animation frame and hands it to stepFlight.
// A button already held when polling starts counts as held, not pressed, so
// the press that started the flight does not also fire.

const TRIGGER_THRESHOLD = 0.5;
// Standard mapping: A / RT fire the laser; B / X / LT drop a bomb.
export const WEAPON_BUTTONS = Object.freeze({ laser: [0, 7], bomb: [1, 2, 6] });
export const WEAPON_KEYS = Object.freeze({ ' ': 'laser', f: 'laser', F: 'laser', b: 'bomb', B: 'bomb' });

export function useSkylineWeapons({ enabled = true, getGamepads, onGamepad } = {}) {
  const queue = useRef([]);
  const onGamepadRef = useRef(onGamepad);
  onGamepadRef.current = onGamepad;

  useEffect(() => {
    queue.current = [];
    if (!enabled) return undefined;
    const handler = (event) => {
      const action = WEAPON_KEYS[event.key];
      if (!action || event.repeat) return;
      event.preventDefault();
      queue.current.push(action);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const read = getGamepads
      || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
    const held = new Map();
    const seen = new Set();
    let frame = 0;
    const poll = () => {
      for (const pad of Array.from(read() || [])) {
        if (!pad) continue;
        const primed = seen.has(pad.index);
        if (!primed) { seen.add(pad.index); onGamepadRef.current?.(pad); }
        for (const [action, indexes] of Object.entries(WEAPON_BUTTONS)) {
          const down = indexes.some((index) => {
            const button = pad.buttons?.[index];
            return !!button && (button.pressed || button.value > TRIGGER_THRESHOLD);
          });
          const key = `${pad.index}:${action}`;
          if (primed && down && !held.get(key)) queue.current.push(action);
          held.set(key, down);
        }
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [enabled, getGamepads]);

  return useCallback(() => {
    const actions = queue.current;
    queue.current = [];
    return actions;
  }, []);
}

export default useSkylineWeapons;
