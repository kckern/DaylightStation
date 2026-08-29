import { useCallback, useEffect, useRef, useState } from 'react';
import { presentationAction } from '@shared-presentation/index.mjs';

const KEY_ACTIONS = Object.freeze({
  ArrowUp: 'move.north', KeyW: 'move.north',
  ArrowRight: 'move.east', KeyD: 'move.east',
  ArrowDown: 'move.south', KeyS: 'move.south',
  ArrowLeft: 'move.west', KeyA: 'move.west',
  Space: 'action.primary', Enter: 'action.primary',
  ShiftLeft: 'action.secondary', ShiftRight: 'action.secondary',
  Escape: 'menu.back', KeyP: 'pause',
});

const GAMEPAD_BUTTONS = Object.freeze({ 0: 'action.primary', 1: 'action.secondary', 9: 'pause' });

function eventTargetAcceptsText(target) {
  return Boolean(target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName));
}

export function keyboardAction(code) { return KEY_ACTIONS[code] ?? null; }

/** Device-neutral semantic input. MIDI/piano and host contexts can call dispatch directly. */
export function usePresentationInput({ enabled = true, onAction } = {}) {
  const callbackRef = useRef(onAction); const gamepadState = useRef(new Map()); const [gamepads, setGamepads] = useState([]);
  useEffect(() => { callbackRef.current = onAction; }, [onAction]);
  const dispatch = useCallback((action, phase = 'press', { value = 1, source = 'host', timestamp = performance.now() } = {}) => {
    if (!enabled || !action) return null;
    const normalized = presentationAction(action, { phase, value, source, timestamp }); callbackRef.current?.(normalized); return normalized;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handle = (event) => {
      if (eventTargetAcceptsText(event.target)) return;
      const action = keyboardAction(event.code); if (!action) return;
      event.preventDefault(); dispatch(action, event.type === 'keydown' ? 'press' : 'release', { source: 'keyboard', timestamp: event.timeStamp });
    };
    window.addEventListener('keydown', handle); window.addEventListener('keyup', handle);
    return () => { window.removeEventListener('keydown', handle); window.removeEventListener('keyup', handle); };
  }, [dispatch, enabled]);

  useEffect(() => {
    if (!enabled || typeof navigator.getGamepads !== 'function') return undefined;
    let frame = null; let lastSummary = ''; const state = gamepadState.current;
    const poll = (timestamp) => {
      const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean); const summary = pads.map((pad) => `${pad.index}:${pad.id}`).join('|');
      if (summary !== lastSummary) { lastSummary = summary; setGamepads(pads.map((pad) => ({ index: pad.index, id: pad.id, mapping: pad.mapping }))); }
      for (const pad of pads) {
        const prior = state.get(pad.index) ?? {}; const next = {};
        const horizontal = Math.abs(pad.axes?.[0] ?? 0) >= 0.45 ? Math.sign(pad.axes[0]) : 0; const vertical = Math.abs(pad.axes?.[1] ?? 0) >= 0.45 ? Math.sign(pad.axes[1]) : 0;
        const directional = { 'move.west': horizontal < 0 || pad.buttons?.[14]?.pressed, 'move.east': horizontal > 0 || pad.buttons?.[15]?.pressed, 'move.north': vertical < 0 || pad.buttons?.[12]?.pressed, 'move.south': vertical > 0 || pad.buttons?.[13]?.pressed };
        for (const [action, pressed] of Object.entries(directional)) {
          next[action] = Boolean(pressed); if (next[action] !== Boolean(prior[action])) dispatch(action, pressed ? 'press' : 'release', { source: `gamepad:${pad.index}`, timestamp });
        }
        for (const [button, action] of Object.entries(GAMEPAD_BUTTONS)) {
          next[action] = Boolean(pad.buttons?.[button]?.pressed); if (next[action] !== Boolean(prior[action])) dispatch(action, next[action] ? 'press' : 'release', { source: `gamepad:${pad.index}`, timestamp });
        }
        state.set(pad.index, next);
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll); return () => { cancelAnimationFrame(frame); state.clear(); };
  }, [dispatch, enabled]);

  return { dispatch, gamepads };
}

export const PRESENTATION_DPAD = Object.freeze([
  { action: 'move.north', label: 'Up', glyph: '▲' },
  { action: 'move.west', label: 'Left', glyph: '◀' },
  { action: 'move.south', label: 'Down', glyph: '▼' },
  { action: 'move.east', label: 'Right', glyph: '▶' },
]);
