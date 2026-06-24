// parseMusicXml — MusicXML document → a renderer-agnostic Score model.
//
// The model is the decoupling seam: MusicXML quirks stop here. Notes carry an
// absolute onset (in quarter-note beats) so the layout/cursor/play-along layers
// never have to re-derive timing. Unknown elements are skipped, not fatal — the
// foundation targets ~80% of notation (the seed's grand staff + the common
// additions: rests, chords, dots, accidentals), deferring the obscure rest.

const STEP_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI number for a pitch ({ step, octave, alter }). C4 = 60, E4 = 64. */
export function pitchToMidi({ step, octave, alter = 0 }) {
  return (octave + 1) * 12 + (STEP_SEMITONE[step] ?? 0) + alter;
}

const num = (el, sel, def = 0) => {
  const n = el?.querySelector(sel);
  const v = n ? Number(n.textContent) : NaN;
  return Number.isFinite(v) ? v : def;
};
const text = (el, sel, def = null) => el?.querySelector(sel)?.textContent?.trim() ?? def;

/**
 * Parse a MusicXML string into a Score model.
 * @param {string} xml
 * @returns {{ divisions:number, tempo:number, timeSig:{beats,beatType}, key:{fifths},
 *   parts: Array<{ id, name, staves, clefs, measures: Array<{number, notes: Note[]}>, notes: Note[] }> }}
 */
export function parseMusicXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid MusicXML');

  const partNames = {};
  for (const sp of doc.querySelectorAll('part-list score-part')) {
    partNames[sp.getAttribute('id')] = text(sp, 'part-name', sp.getAttribute('id'));
  }

  const score = { divisions: 1, tempo: 100, timeSig: { beats: 4, beatType: 4 }, key: { fifths: 0 }, parts: [] };
  score.title = text(doc, 'work work-title', null) || text(doc, 'movement-title', null);
  score.composer = doc.querySelector('identification creator[type="composer"]')?.textContent?.trim()
    || doc.querySelector('creator')?.textContent?.trim() || null;

  for (const partEl of doc.querySelectorAll('part')) {
    const id = partEl.getAttribute('id');
    const part = { id, name: partNames[id] || id, staves: 1, clefs: {}, measures: [], notes: [] };

    let divisions = score.divisions;
    let measureStartQuarter = 0; // absolute, accumulates across measures
    let measureQuarters = (score.timeSig.beats * 4) / score.timeSig.beatType;

    for (const measureEl of partEl.querySelectorAll('measure')) {
      const measure = { number: Number(measureEl.getAttribute('number')) || part.measures.length + 1, notes: [] };

      // Attributes can appear at the start of any measure and persist.
      const attr = measureEl.querySelector('attributes');
      if (attr) {
        divisions = num(attr, 'divisions', divisions);
        score.divisions = divisions;
        if (attr.querySelector('key fifths')) score.key = { fifths: num(attr, 'key fifths', 0) };
        if (attr.querySelector('time')) {
          score.timeSig = { beats: num(attr, 'time beats', 4), beatType: num(attr, 'time beat-type', 4) };
          measureQuarters = (score.timeSig.beats * 4) / score.timeSig.beatType;
        }
        if (attr.querySelector('staves')) part.staves = num(attr, 'staves', 1);
        for (const clefEl of attr.querySelectorAll('clef')) {
          const n = Number(clefEl.getAttribute('number')) || 1;
          part.clefs[n] = { sign: text(clefEl, 'sign', 'G'), line: num(clefEl, 'line', 2) };
        }
        measure.attributes = { clefs: { ...part.clefs }, key: score.key, time: score.timeSig };
      }
      // Tempo (sound tempo or metronome per-minute).
      const sound = measureEl.querySelector('sound[tempo]');
      if (sound) score.tempo = Math.round(Number(sound.getAttribute('tempo')));
      const perMin = measureEl.querySelector('metronome per-minute');
      if (perMin && !sound) score.tempo = Number(perMin.textContent) || score.tempo;

      // Walk children in document order, tracking a time cursor (in divisions).
      let cursor = 0; // divisions from measure start
      let lastOnset = 0;
      for (const child of measureEl.children) {
        const tag = child.tagName;
        if (tag === 'backup') { cursor -= num(child, 'duration', 0); continue; }
        if (tag === 'forward') { cursor += num(child, 'duration', 0); continue; }
        if (tag !== 'note') continue;

        const isChord = !!child.querySelector('chord');
        const isRest = !!child.querySelector('rest');
        const duration = num(child, 'duration', 0);
        const onsetDiv = isChord ? lastOnset : cursor;
        const note = {
          staff: num(child, 'staff', 1),
          voice: num(child, 'voice', 1),
          rest: isRest,
          duration,
          durationQuarters: divisions ? duration / divisions : 0,
          type: text(child, 'type', 'quarter'),
          dots: child.querySelectorAll('dot').length,
          chord: isChord,
          stem: text(child, 'stem', null),
          onsetQuarter: measureStartQuarter + (divisions ? onsetDiv / divisions : 0),
          measureNumber: measure.number,
        };
        if (!isRest) {
          const pitch = {
            step: text(child, 'pitch step', 'C'),
            octave: num(child, 'pitch octave', 4),
            alter: num(child, 'pitch alter', 0),
          };
          note.pitch = pitch;
          note.midi = pitchToMidi(pitch);
        }
        measure.notes.push(note);
        part.notes.push(note);
        lastOnset = onsetDiv;
        if (!isChord) cursor += duration;
      }

      part.measures.push(measure);
      measureStartQuarter += measureQuarters;
    }
    score.parts.push(part);
  }
  return score;
}

export default parseMusicXml;
