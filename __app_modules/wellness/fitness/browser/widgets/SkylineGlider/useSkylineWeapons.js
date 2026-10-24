import { useCallback, useEffect, useRef } from 'react';

// Fire buttons for flight. Presses are edge-detected and queued; the flight
// loop drains the queue once per animation frame and hands it to stepFlight.
// A button already held when polling starts counts as held, not pressed, so
// the press that started the flight does not also fire.

const TRIGGER_THRESHOLD = 0.5;
// Standard mapping: A / RT fire the laser; B / X / LT drop a bomb.
export const WEAPON_BUTTONS = Object.freeze({ laser: [0, 7], bomb: [1, 2, 6] });
export const WEAPON_KEYS = Object.freeze({ ' ': 'laser', f: 'laser', F: 'laser', b: 'bomb', B: 'bomb' });

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

// The fire action for a key event, or null when the key is not ours: browser
// shortcuts (Ctrl/Cmd+F, Ctrl+B) and typing into a field are left alone.
function fireKeyAction(event) {
  const action = WEAPON_KEYS[event.key];
  if (!action || event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target;
  if (target && (TYPING_TAGS.has(target.tagName) || target.isContentEditable)) return null;
  return action;
}

export function useSkylineWeapons({ enabled = true, getGamepads, onGamepad } = {}) {
  const queue = useRef([]);
  const onGamepadRef = useRef(onGamepad);
  onGamepadRef.current = onGamepad;

  useEffect(() => {
    queue.current = [];
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      const action = fireKeyAction(event);
      if (!action) return;
      event.preventDefault();
      // A tapped End flight / Mute button keeps focus, and Space would press it
      // on keyup in Firefox. Drop the focus so fire keys only ever fire.
      const target = event.target;
      if (target && target !== document.body && typeof target.blur === 'function') target.blur();
      if (!event.repeat) queue.current.push(action);
    };
    const onKeyUp = (event) => { if (fireKeyAction(event)) event.preventDefault(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
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
