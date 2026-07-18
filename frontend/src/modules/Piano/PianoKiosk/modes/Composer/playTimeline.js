// playTimeline.js — turn a Composer MODEL score into the flat, time-sorted event
// list useScoreTransport consumes: [{t, type:'note_on'|'note_off', note, velocity}]
// with `t` in ms from the start of playback.
//
// MODEL-BASED, NOT LAYOUT-BASED, deliberately. SheetMusic derives its timeline
// from the OSMD layout extract, which only exists after an engrave. The Composer
// must be able to play back a bar the kid just entered — while it is still wet
// ink and hasn't been engraved at all — so this reads the score document itself.
// It therefore works on a draft, before or without any engraving.
import { pitchToMidi } from '@/modules/MusicNotation/parseMusicXml.js';
import { DIVISIONS, noteDivisions } from '@/modules/MusicNotation/duration.js';

// Release each note slightly before its notated end. Without this gap a repeated
// pitch would get its note_off at the same instant as the next note_on, and the
// synth (or the piano, over BLE, where ordering at equal timestamps is not
// guaranteed) can swallow the re-strike or cut the second note dead.
const GATE = 0.9;

const DEFAULT_TEMPO = 100;

/**
 * Quarter-note length of a note/rest, honoring dots and triplets.
 *
 * Uses the shared `noteDivisions` rather than a local duration table so dotted,
 * double-dotted and TRIPLET values play back at the length the editor and the
 * serializer already agree on — a local {whole:4,…} map would silently play
 * triplets at their undotted value. Returns null for a type outside the v1
 * palette (noteDivisions throws by design); the caller skips those.
 */
function quartersOf(note) {
  try {
    return noteDivisions(note) / DIVISIONS;
  } catch {
    return null;
  }
}

function midiOf(note) {
  const m = note.pitch ? pitchToMidi(note.pitch) : note.midi;
  return Number.isFinite(m) ? m : null;
}

/**
 * Build a playable timeline from a Composer score.
 *
 * @param {object} score model score ({tempo, parts:[{measures:[{notes:[…]}]}]})
 * @param {object} [opts]
 * @param {number} [opts.velocity=80] note-on velocity for every note
 * @param {number} [opts.startAtMeasure=0] play from this measure; earlier events
 *   are dropped and `t` is re-zeroed to that measure's downbeat.
 * @returns {Array<{t:number, type:string, note:number, velocity:number}>}
 */
export function buildComposerTimeline(score, { velocity = 80, startAtMeasure = 0 } = {}) {
  const parts = score?.parts || [];
  if (!parts.length) return [];
  const msPerQuarter = 60000 / (score.tempo || DEFAULT_TEMPO);

  // Tagged with the measure they belong to so startAtMeasure can drop a note and
  // its note_off TOGETHER. Filtering by time instead would strand the note_off of
  // a note that starts before the cut and rings past it — an orphan note_off that
  // the transport would send with no matching note_on.
  const tagged = [];
  let zeroMs = 0;

  for (let p = 0; p < parts.length; p++) {
    const measures = parts[p]?.measures || [];
    let barStart = 0; // ms at this measure's downbeat, on THIS part's clock

    for (let m = 0; m < measures.length; m++) {
      // Rebase off part 0's downbeat. Parts run in PARALLEL on their own clocks
      // (each restarts at 0), so any one of them dates the measure — take the
      // first so a short/ragged later part can't move the origin.
      if (m === startAtMeasure && p === 0) zeroMs = barStart;

      // Per-voice cursors, matching measureFill's per-voice accounting
      // (model/editor.js): a grand-staff bar is two voices each filling the bar
      // independently, not one concatenated stream. Summing them into a single
      // cursor would play the left hand AFTER the right instead of with it.
      const cursor = new Map();
      const lastOnset = new Map();
      const at = (v) => (cursor.has(v) ? cursor.get(v) : barStart);

      for (const note of measures[m]?.notes || []) {
        const v = note.voice ?? 1;
        const quarters = quartersOf(note);
        if (quarters == null) continue; // unplayable type — degrade, don't throw

        // Chord notes share their principal's onset and consume NO bar time —
        // exactly how measureFill scores them. Their own `type` still sets their
        // length (that's what MusicXML means, and the model stores it per note).
        const isChord = !!note.chord;
        const onset = isChord ? (lastOnset.has(v) ? lastOnset.get(v) : at(v)) : at(v);
        const durMs = quarters * msPerQuarter;
        if (!isChord) {
          lastOnset.set(v, onset);
          cursor.set(v, onset + durMs);
        }

        if (note.rest) continue; // rests advance the clock and sound nothing
        const midi = midiOf(note);
        if (midi == null) continue;
        tagged.push({ m, t: onset, type: 'note_on', note: midi, velocity });
        tagged.push({ m, t: onset + durMs * GATE, type: 'note_off', note: midi, velocity: 0 });
      }

      // The bar's length is its LONGEST voice — a bar under-filled in one voice
      // must not pull the next downbeat early for the others.
      barStart = cursor.size ? Math.max(barStart, ...cursor.values()) : barStart;
    }
  }

  return tagged
    .filter((e) => e.m >= startAtMeasure)
    .map((e) => ({ t: Math.round(e.t - zeroMs), type: e.type, note: e.note, velocity: e.velocity }))
    .sort((a, b) => a.t - b.t); // stable: equal-t note_off (gated early) still precedes the next note_on
}

export default buildComposerTimeline;
