// instrumentsKeyMap.js — pure key-map logic for the Instruments control surface.
// The lowest piano keys drive navigation; everything else plays the loaded voice.

/** The navigation keys: lowest notes mapped to control actions. SSOT for the map. */
export const NAV_KEYS = [
  { note: 36, action: 'prev', label: 'Prev' },     // C2
  { note: 38, action: 'next', label: 'Next' },     // D2
  { note: 40, action: 'activate', label: 'Select' }, // E2
  { note: 41, action: 'panic', label: 'Panic' },   // F2
];

const NOTE_ACTIONS = new Map(NAV_KEYS.map((k) => [k.note, k.action]));

/** Map a MIDI note to a nav action, or null (note plays normally). */
export function noteToAction(note) {
  return NOTE_ACTIONS.get(note) ?? null;
}

/** Always prepend the Onboard (passthrough) entry to the configured instruments. */
export function entriesFor(instruments) {
  return [{ id: '__onboard__', name: 'Onboard', engine: null }, ...(instruments || [])];
}

/** Pure index math for prev/next selection with wraparound. */
export function moveSelection(index, action, count) {
  if (count <= 0) return 0;
  if (action === 'prev') return (index - 1 + count) % count;
  if (action === 'next') return (index + 1) % count;
  return index;
}
