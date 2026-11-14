// Pure helpers behind CurrentChordStaff: turning the live MIDI surface into onsets,
// and the flow into render columns. Kept out of the component so both are testable
// without React.
import { flowColumns } from '../../../../../__capabilities/music-notation/browser/model/noteFlow.js';
import { identifyChord } from '../theory/chordNaming.js';

/**
 * Compare the surface with what we saw last time. Diffing by key presence alone missed
 * a re-strike on a key still held (the Map entry just gets a new timestamp), so an
 * onset is a key that is new OR whose timestamp changed.
 *
 * @param {Map<number, number>} prev - held note -> timestamp from the last diff
 * @param {Map<number, {timestamp?: number}>} activeNotes
 * @param {number} now
 * @returns {{onsets: number[], at: number, released: boolean, next: Map<number, number>}}
 */
export function diffNoteSurface(prev, activeNotes, now) {
  const next = new Map();
  const onsets = [];
  const stamps = [];
  for (const [note, data] of activeNotes) {
    const ts = data?.timestamp;
    const stamp = Number.isFinite(ts) ? ts : (prev.get(note) ?? now);
    next.set(note, stamp);
    if (!prev.has(note) || prev.get(note) !== stamp) {
      onsets.push(note);
      if (Number.isFinite(ts)) stamps.push(ts);
    }
  }
  let released = false;
  for (const note of prev.keys()) if (!activeNotes.has(note)) { released = true; break; }
  // Earliest stamp of the batch: the column anchors to the first key of the gesture,
  // using the arrival time useMidiSubscription gave each note rather than effect time.
  const at = stamps.length ? Math.min(...stamps) : now;
  return { onsets, at, released, next };
}

/**
 * Columns for ChordStaffRenderer. Every column is spelled with the CURRENT key, so the
 * letters drawn always agree with the key signature drawn beside them. Freezing a
 * closed column's spelling (the old cache) saved a note from re-spelling when the key
 * moved, but left it contradicting the new signature: a frozen G flat under six sharps
 * drew a double flat. A column re-spelling on a key change is the lesser fault, and the
 * key now changes rarely (see detectKey's hysteresis).
 *
 * @param {object} flow
 * @param {string[]} durations
 * @param {string} keySig
 */
export function buildRenderColumns(flow, durations, keySig) {
  const midiCols = flowColumns(flow);
  return flow.columns.map((c, i) => ({
    midis: midiCols[i],
    spelling: identifyChord(midiCols[i], keySig).spelling,
    // Arrivals, not a roll verdict: the renderer reads each hand's roll from them.
    duration: durations[i] ?? 'q',
    arrivals: c.arrivals ?? [],
  }));
}
