// One meaning for every key on every Skyline Invaders menu (lobby, calibration,
// pause, result), so the keyboard, the gamepad (useGamepadKeys speaks key
// names) and the garage's foot pad all drive the same actions.
//
// The foot pad sends letters, and which ones is a matter of how it was last
// programmed, so any plain key accepts. Digits 1-6 are bound by the garage
// box's OS (they close or reload the kiosk) and are never acted on.
import { classifyKey } from './spikeScript.js';

const DIRECTIONS = Object.freeze({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' });

/** @returns {'left'|'right'|'up'|'down'|'accept'|'back'|null} */
export function menuAction(event = {}) {
  const verdict = classifyKey(event);
  if (verdict.action === 'ignored') return null;
  if (DIRECTIONS[event.key]) return DIRECTIONS[event.key];
  return verdict.action === 'redo' ? 'back' : 'accept';
}
