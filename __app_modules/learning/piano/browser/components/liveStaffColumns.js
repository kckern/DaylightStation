// Pure helpers behind CurrentChordStaff: turning the live MIDI surface into onsets,
// and the flow into render columns. Kept out of the component so both are testable
// without React.
import { flowColumns, flowRolls } from '../../../../../__capabilities/music-notation/browser/model/noteFlow.js';
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
 * Columns for ChordStaffRenderer. Spelling is chosen per chord from the key, and a key
 * re-detected mid-phrase used to re-spell notes already on the page (A flat turning to
 * G sharp under your eyes). So only the newest column follows the live key; a closed
 * column keeps the spelling it was first given, cached by its startedAt.
 *
 * @param {object} flow
 * @param {string[]} durations
 * @param {string} keySig
 * @param {Map<number, object>} cache - mutated: closed-column spellings, pruned here
 */
export function buildRenderColumns(flow, durations, keySig, cache) {
  const midiCols = flowColumns(flow);
  const rolls = flowRolls(flow);
  const last = flow.columns.length - 1;
  const live = new Set();
  const out = flow.columns.map((c, i) => {
    live.add(c.startedAt);
    let spelling;
    if (i === last) {
      spelling = identifyChord(midiCols[i], keySig).spelling;
    } else {
      spelling = cache.get(c.startedAt);
      if (spelling === undefined) {
        spelling = identifyChord(midiCols[i], keySig).spelling;
        cache.set(c.startedAt, spelling);
      }
    }
    return { midis: midiCols[i], spelling, duration: durations[i] ?? 'q', roll: rolls[i] };
  });
  for (const k of [...cache.keys()]) if (!live.has(k)) cache.delete(k);
  return out;
}
