// scoreTimeline — musical time (quarter-note beats) → wall-clock ms.
//
// A tempo map is a sorted [{onsetQuarter, bpm}] with the first entry at
// quarter 0. Every playback surface (metronome cursor, Play-mode MIDI out)
// converts through the same map, so mid-piece tempo changes stay in sync
// between what the user sees and what the piano plays.

/** Normalize raw tempo entries into a clean map. Never returns empty. */
export function buildTempoMap(entries, fallbackBpm = 90) {
  const clean = (entries || [])
    .filter((e) => e && Number.isFinite(e.onsetQuarter) && Number.isFinite(e.bpm) && e.bpm > 0)
    .sort((a, b) => a.onsetQuarter - b.onsetQuarter);
  const map = [];
  for (const e of clean) {
    const last = map[map.length - 1];
    if (last && e.onsetQuarter === last.onsetQuarter) { last.bpm = e.bpm; continue; }
    if (last && e.bpm === last.bpm) continue;
    map.push({ onsetQuarter: e.onsetQuarter, bpm: e.bpm });
  }
  if (!map.length) return [{ onsetQuarter: 0, bpm: fallbackBpm }];
  map[0] = { onsetQuarter: 0, bpm: map[0].bpm }; // opening tempo governs from beat one
  return map;
}

/** Wall-clock ms elapsed from quarter 0 to `quarter`. */
export function msAtQuarter(tempoMap, quarter) {
  let ms = 0;
  for (let i = 0; i < tempoMap.length; i++) {
    const seg = tempoMap[i];
    if (quarter <= seg.onsetQuarter) break;
    const end = tempoMap[i + 1]?.onsetQuarter ?? Infinity;
    ms += (Math.min(quarter, end) - seg.onsetQuarter) * (60000 / seg.bpm);
    if (quarter <= end) break;
  }
  return ms;
}

/** Cursor steps: one {t, index} per melody event. */
export function buildStepTimeline(events, tempoMap) {
  return (events || []).map((e, index) => ({ t: msAtQuarter(tempoMap, e.onsetQuarter), index }));
}

const MIN_SOUND_MS = 20; // never emit a zero/negative-length note
const REARTICULATE_MS = 10; // lift early so a repeated pitch re-strikes

/**
 * Flat, time-sorted note_on/note_off stream for MIDI-out playback.
 * @param {Array<{midi,staff,onsetQuarter,durationQuarters}>} notes
 * @param {Array} tempoMap
 * @param {{isAudible?: (note) => boolean}} [opts] - part mute filter
 */
export function buildNoteTimeline(notes, tempoMap, { isAudible = () => true } = {}) {
  const out = [];
  for (const n of notes || []) {
    if (!isAudible(n)) continue;
    const on = msAtQuarter(tempoMap, n.onsetQuarter);
    const off = msAtQuarter(tempoMap, n.onsetQuarter + (n.durationQuarters || 0));
    out.push({ t: on, type: 'note_on', note: n.midi, velocity: n.velocity ?? 80, staff: n.staff });
    out.push({ t: Math.max(on + MIN_SOUND_MS, off - REARTICULATE_MS), type: 'note_off', note: n.midi, staff: n.staff });
  }
  // Stable order at equal t: offs before ons so repeated pitches re-articulate.
  return out.sort((a, b) => a.t - b.t || (a.type === b.type ? 0 : a.type === 'note_off' ? -1 : 1));
}

/**
 * Scale a time-sorted timeline in the time dimension. `factor` is a duration
 * multiplier: factor>1 slows down (t grows), factor<1 speeds up. Returns a new
 * array; every entry's `t` becomes `t * factor`, other fields preserved.
 */
export function scaleTimeline(timeline, factor) {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return (timeline || []).map((e) => ({ ...e, t: e.t * f }));
}

export default { buildTempoMap, msAtQuarter, buildStepTimeline, buildNoteTimeline, scaleTimeline };
