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

/** One page of pieces: C4 to C5, eight faces wide enough to read across a room. */
export const PIECE_NOTES = Object.freeze(SELECTION_NOTES.slice(0, 8));
/** Page keys: C3, D3, E3… one per page. */
export const PAGE_NOTES = SECONDARY_NOTES;

const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
/** "C4" for 60; a black key keeps its number. */
export function noteName(midi) {
  const index = WHITE_PCS.indexOf(midi % 12);
  return index === -1 ? String(midi) : `${NAMES[index]}${Math.floor(midi / 12) - 1}`;
}

/**
 * The pieces on page `page` bound to PIECE_NOTES, plus one page key per page
 * when there is more than one. A page past the end clamps to the last.
 */
export function piecePage(pieces, page = 0, perPage = PIECE_NOTES.length) {
  const list = Array.isArray(pieces) ? pieces : [];
  const size = Math.max(1, Math.min(perPage, PIECE_NOTES.length));
  // More pages than page keys cannot be reached: the extra pieces are left off
  // (and reported) rather than bound to keys that are not there.
  const pageCount = Math.max(1, Math.min(PAGE_NOTES.length, Math.ceil(list.length / size)));
  const at = Math.min(Math.max(0, Math.floor(Number(page) || 0)), pageCount - 1);
  const { slots } = bindNoteSlots(list.slice(at * size, (at + 1) * size), PIECE_NOTES);
  const pageSlots = pageCount > 1
    ? bindNoteSlots(Array.from({ length: pageCount }, (_, index) => ({ page: index, label: `Page ${index + 1}` })), PAGE_NOTES).slots
      .map((slot) => ({ ...slot, current: slot.item.page === at }))
    : [];
  return { page: at, pageCount, slots, pageSlots, unreachable: Math.max(0, list.length - pageCount * size) };
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
