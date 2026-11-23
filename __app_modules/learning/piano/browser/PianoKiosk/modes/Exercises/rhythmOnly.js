// The rhythm recovery rung ("Tap the rhythm"): the passage's timing with no pitch asked of the child.
// Any key counts, and the engine is handed an expectation of one note per beat-event on one pitch, so the
// same timed judge, windows and count-in grade WHEN the child came in and nothing else. Pure.

/** The one pitch the rung expects, and every key played is read as. */
export const RHYTHM_MIDI = 60;

/**
 * The expectation with each event reduced to one note on `RHYTHM_MIDI` (a chord, or both hands together, is
 * one tap). Event ids, onsets, spans, the tempo map and the bar map are unchanged, so cursor, windows and
 * coverage read as for the real passage.
 */
export function toRhythmExpectation(expectation) {
  if (!expectation?.events) return expectation;
  return {
    ...expectation,
    events: expectation.events.map((event) => {
      const first = event.notes?.[0];
      return { ...event, notes: first ? [{ ...first, id: `${first.id}:rhythm`, midi: RHYTHM_MIDI }] : [] };
    }),
  };
}

/**
 * The keys held, as the engine should see them: while any physical key is down, `RHYTHM_MIDI` is down, stamped
 * with the earliest press among them (the moment the tap began). A second key struck while one is still held
 * is the same tap; lifting between taps is what makes the next one.
 */
export function rhythmNotes(activeNotes) {
  if (!activeNotes?.size) return activeNotes ?? new Map();
  let earliest = Infinity;
  let velocity = 1;
  for (const note of activeNotes.values()) {
    const stamp = Number(note?.timestamp);
    if (Number.isFinite(stamp) && stamp < earliest) { earliest = stamp; velocity = note?.velocity ?? 1; }
  }
  return new Map([[RHYTHM_MIDI, { velocity, ...(Number.isFinite(earliest) ? { timestamp: earliest } : {}) }]]);
}
