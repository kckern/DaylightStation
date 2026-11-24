// officeMenu.js — the Sheet Music menu on the office screen.
//
// No playable key is ever a command while the music has the keyboard: every
// navigation choice lives in this menu, opened by holding the board's lowest
// and highest keys (useEdgeHold). While it is open the take is paused and every
// key is navigation; closing it gives every key back to the music. So its
// choices can sit on the white keys from middle C, where the eye and the hand
// already are, one fixed key each: a choice that does nothing now keeps its key.

import { SELECTION_NOTES } from '../../../../game-platform/input/useNoteSelection.js';
import { noteName } from './officeKeys.js';

export const MENU_KEYS = Object.freeze([
  { id: 'resume' },
  { id: 'pieces', label: 'Pieces' },
  { id: 'previous', label: 'Previous' },
  { id: 'next', label: 'Next' },
  { id: 'retry', label: 'Try again' },
  { id: 'later', label: 'Come back later' },
  { id: 'leave', label: 'Leave' },
].map((key, index) => Object.freeze({ ...key, note: SELECTION_NOTES[index] })));

/**
 * The menu as drawn. `actions` are the drill's (LearnCoach publishes previous,
 * next, retry and later through useKeyStrip): id → `{ onSelect, label? }`.
 * `resume` (Close, or Resume over a paused take), `pieces` (in a piece) and
 * `leave` are the host's own and always there; in the picker only Close and
 * Leave are offered.
 */
export function menuChoices({ inDrill = false, paused = false, actions = {} } = {}) {
  return MENU_KEYS.map((key) => {
    const action = inDrill ? actions?.[key.id] ?? null : null;
    const own = key.id === 'resume' || key.id === 'leave' || (key.id === 'pieces' && inDrill);
    const label = key.id === 'resume' ? (inDrill && paused ? 'Resume' : 'Close') : action?.label ?? key.label;
    return { id: key.id, note: key.note, noteName: noteName(key.note), label,
      enabled: own || typeof action?.onSelect === 'function' };
  });
}
