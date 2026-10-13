// useNoteSelection.js — pick an item from a list by playing its key.
//
// The office screen has no touchscreen, so any list that needs a tap is a dead
// end there: Piano Hero asks for a song before it can start, and a player with
// only a piano in front of them could not answer.
//
// Same grammar the game launcher already teaches — each choice wears the note
// that picks it, you play the note, it happens — so the second surface costs no
// new vocabulary.

import { useEffect, useMemo, useRef } from 'react';

/** White keys, C4 upward. The span a hand finds without looking. */
export const SELECTION_NOTES = Object.freeze([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]);
/** A lower row, for a second axis (tabs) that must not collide with the first. */
export const SECONDARY_NOTES = Object.freeze([48, 50, 52, 53, 55, 57, 59]);

const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const nameFor = (midi) => {
  const pc = midi % 12;
  const idx = [0, 2, 4, 5, 7, 9, 11].indexOf(pc);
  return idx === -1 ? String(midi) : `${NAMES[idx]}${Math.floor(midi / 12) - 1}`;
};

/**
 * Pair each item with a note, in order. Items past the ladder get none — they
 * are still listed and still tappable, they just cannot be played, and
 * `dropped` says so rather than the list quietly implying everything is
 * reachable.
 */
export function bindNoteSlots(items, notes = SELECTION_NOTES) {
  const list = Array.isArray(items) ? items : [];
  const bound = list.slice(0, notes.length).map((item, i) => ({
    item, index: i, note: notes[i], noteName: nameFor(notes[i]),
  }));
  return { slots: bound, dropped: list.slice(notes.length) };
}

/**
 * Call `onSelect(item, slot)` when a bound note is newly STRUCK.
 *
 * Only fresh strikes count: a key already down when the list appears — the one
 * that opened it — is not a choice. That is the same rule the launcher applies
 * to itself, and the reason opening a list does not immediately answer it.
 *
 * @param {object}   args
 * @param {Map}      args.activeNotes
 * @param {Array}    args.slots     - from bindNoteSlots
 * @param {boolean}  args.enabled
 * @param {Function} args.onSelect
 */
export function useNoteSelection({ activeNotes, slots, enabled = true, onSelect }) {
  const prevRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const byNote = useMemo(() => {
    const m = new Map();
    for (const slot of slots || []) m.set(slot.note, slot);
    return m;
  }, [slots]);

  useEffect(() => {
    const live = activeNotes instanceof Map ? activeNotes : new Map();
    const current = new Set(live.keys());
    // Seed before the enabled guard, every run: the keys down at the moment
    // this list appears must not read as struck on the next pass.
    const prev = prevRef.current;
    prevRef.current = current;
    if (!enabled || prev === null) return;

    const struck = [...current].filter((n) => !prev.has(n)).sort((a, b) => a - b);
    for (const note of struck) {
      const slot = byNote.get(note);
      if (!slot) continue;
      onSelectRef.current?.(slot.item, slot);
      return;
    }
  }, [activeNotes, enabled, byNote]);
}

export default useNoteSelection;
