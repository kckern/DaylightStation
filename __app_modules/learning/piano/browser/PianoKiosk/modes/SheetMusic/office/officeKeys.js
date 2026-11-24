// officeKeys.js — which key does what in Sheet Music on the office screen.
//
// The office screen has no touch input: every choice is a key, drawn as a key
// face that wears its note. Three fixed rows, chosen so they never collide:
//   - the PIECES, on the white keys from middle C up (the launcher's own row);
//   - the PAGES of a long list, on the octave below (SECONDARY_NOTES);
//   - the drill's KEY STRIP, on the octave below that (C2–A2), far under where a
//     passage starts, because before a take "any key" arms it.
// Spec: ops:docs/superpowers/specs/2026-11-23-piano-office-sheet-music-design.md

import { SELECTION_NOTES, SECONDARY_NOTES, bindNoteSlots } from '../../../../game-platform/input/useNoteSelection.js';

/** Six pieces a page, C4 to A4: wide enough faces to read across a room. */
export const PIECE_NOTES = Object.freeze(SELECTION_NOTES.slice(0, 6));
/** The shelves (the catalog's collections), C4 to C5. */
export const SHELF_NOTES = Object.freeze(SELECTION_NOTES.slice(0, 8));
/** Kept for the key-row contract: the browse keys live on this row. */
export const PAGE_NOTES = SECONDARY_NOTES;

const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
/** "C4" for 60; a black key keeps its number. */
export function noteName(midi) {
  const index = WHITE_PCS.indexOf(midi % 12);
  return index === -1 ? String(midi) : `${NAMES[index]}${Math.floor(midi / 12) - 1}`;
}

/**
 * One page of a list bound to keys: `notes` from the left, the page clamped to
 * the list. Any length can be reached: Previous and Next step one page at a time.
 */
export function listPage(items, page = 0, notes = PIECE_NOTES) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, notes.length);
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const at = Math.min(Math.max(0, Math.floor(Number(page) || 0)), pageCount - 1);
  const { slots } = bindNoteSlots(list.slice(at * size, (at + 1) * size), notes);
  return { page: at, pageCount, slots, hasPrevious: at > 0, hasNext: at < pageCount - 1 };
}

/**
 * The browse keys under the list, one fixed key each so a face never moves:
 * C3 switches between your pieces and the shelves, D3 and E3 turn the page.
 * A key that does nothing right now is drawn dim on its key.
 */
export const BROWSE_KEYS = Object.freeze([
  { id: 'switch', note: SECONDARY_NOTES[0] },
  { id: 'previous', note: SECONDARY_NOTES[1], label: 'Previous' },
  { id: 'next', note: SECONDARY_NOTES[2], label: 'Next' },
]);

/** The browse row as drawn for a level ('mine' | 'shelves' | 'shelf') and its page. */
export function browseSlots(level, page = {}) {
  const switchLabel = level === 'shelves' ? 'Your pieces' : 'All music';
  const enabled = { switch: true, previous: Boolean(page.hasPrevious), next: Boolean(page.hasNext) };
  return BROWSE_KEYS.map((key) => ({
    id: key.id, note: key.note, noteName: noteName(key.note), label: key.id === 'switch' ? switchLabel : key.label,
    enabled: enabled[key.id], item: { browse: key.id },
  }));
}

/**
 * The drill's key strip. Each action owns one key for good, so a face never
 * moves under a hand: an action that does not apply right now is drawn dim on
 * its key rather than another action sliding into its place. Listen is the
 * exception — without a way to sound notes on this piano it is not drawn.
 */
export const STRIP_KEYS = Object.freeze([
  { id: 'pieces', note: 36, label: 'Pieces' },
  { id: 'previous', note: 38, label: 'Previous' },
  { id: 'next', note: 40, label: 'Next' },
  { id: 'retry', note: 41, label: 'Try again' },
  { id: 'later', note: 43, label: 'Come back later' },
  { id: 'listen', note: 45, label: 'Listen' },
]);
export const STRIP_NOTES = Object.freeze(STRIP_KEYS.map((key) => key.note));

/**
 * The strip as drawn: one face per key, with what each does now. `actions` maps
 * an id to `{ onSelect, label? }` (absent or without onSelect = not now).
 */
export function stripSlots(actions = {}, { canListen = false } = {}) {
  return STRIP_KEYS.filter((key) => key.id !== 'listen' || canListen).map((key) => {
    const action = actions[key.id] ?? null;
    return { id: key.id, note: key.note, noteName: noteName(key.note), label: action?.label ?? key.label,
      enabled: typeof action?.onSelect === 'function', item: key };
  });
}
