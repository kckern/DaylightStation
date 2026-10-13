// Studio recording helpers — pure, testable.
//
// A "take" is an array of timestamped events relative to record start:
//   { t, type: 'note_on'|'note_off', note, velocity }
// suitable for replay via the MIDI-out scheduler (useWebMidiBLE.scheduleNotes).

/** Convert an absolute-time event ({type,note,velocity,time}) to a take event relative to t0. */
export function toTakeEvent(evt, t0) {
  return {
    t: Math.max(0, evt.time - t0),
    type: evt.type,
    note: evt.note,
    velocity: evt.velocity ?? 0,
  };
}

/** Duration of a take = the largest event offset (ms). */
export function takeDuration(events) {
  return events.reduce((max, e) => (e.t > max ? e.t : max), 0);
}

/** How many notes were played (note_on events) — for the review summary. */
export function noteOnCount(events) {
  return events.reduce((n, e) => (e.type === 'note_on' ? n + 1 : n), 0);
}

/**
 * Close any notes still held at stop time so playback doesn't leave hung notes.
 * Returns a new events array with synthetic note_off events appended at stopT.
 */
export function closeOpenNotes(events, stopT) {
  const open = new Map(); // note → true while held
  for (const e of events) {
    if (e.type === 'note_on') open.set(e.note, true);
    else if (e.type === 'note_off') open.delete(e.note);
  }
  if (open.size === 0) return events;
  const tail = [...open.keys()].map((note) => ({ t: stopT, type: 'note_off', note, velocity: 0 }));
  return [...events, ...tail];
}
