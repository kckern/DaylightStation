// Pure, DOM-free MusicXML → note-list parser for loop bricks. Runs identically
// in Node (manifest builder) and the browser (lazy audition load). The brick
// format is machine-generated and highly regular, so a targeted element scan is
// deterministic — this is NOT a general MusicXML parser.
//
// Output note shape matches useLoopLibrary.loadNotes / harmonicTimeline /
// loopScheduler: { ppq, timeSig:[beats,beatType], notes:[{ticks,durationTicks,midi}] }.

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Absolute MIDI number from a <pitch> block (C4 → 60). */
function pitchToMidi(step, octave, alter) {
  return (octave + 1) * 12 + LETTER_PC[step] + alter;
}

/** First integer value of <tag>…</tag> in a block, or null. */
function firstInt(block, tag) {
  const m = block.match(new RegExp(`<${tag}>(-?\\d+)</${tag}>`));
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Parse a loop brick's MusicXML into a flat, tempo-free note list in ticks.
 * @param {string} xml raw MusicXML text
 * @returns {{ppq:number, timeSig:[number,number], notes:Array<{ticks:number,durationTicks:number,midi:number}>}}
 */
export function musicXmlToNotes(xml) {
  if (typeof xml !== 'string' || xml.length === 0) {
    return { ppq: 4, timeSig: [4, 4], notes: [] };
  }
  const divisions = firstInt(xml, 'divisions') || 4; // ticks per quarter
  const beats = firstInt(xml, 'beats') || 4;
  const beatType = firstInt(xml, 'beat-type') || 4;
  const barTicks = divisions * (4 / beatType) * beats;

  const notes = [];
  const openTies = new Map(); // midi → index in `notes` of an open tied note

  const measureRe = /<measure\b[^>]*>([\s\S]*?)<\/measure>/g;
  let measureStart = 0;
  let mm;
  while ((mm = measureRe.exec(xml)) !== null) {
    const body = mm[1];
    let cursor = 0;
    let prevStart = 0; // start tick of the last non-chord note (for <chord/>)

    const elemRe = /<(note|backup|forward)\b[^>]*>([\s\S]*?)<\/\1>/g;
    let em;
    while ((em = elemRe.exec(body)) !== null) {
      const tag = em[1];
      const block = em[2];
      const duration = firstInt(block, 'duration') || 0;

      if (tag === 'backup') { cursor -= duration; continue; }
      if (tag === 'forward') { cursor += duration; continue; }

      const isChord = /<chord\s*\/>/.test(block);
      const isRest = /<rest\s*\/?>/.test(block);
      const start = isChord ? prevStart : cursor;

      if (!isRest) {
        const stepM = block.match(/<step>([A-G])<\/step>/);
        const octM = block.match(/<octave>(-?\d+)<\/octave>/);
        if (stepM && octM) {
          const alter = firstInt(block, 'alter') || 0;
          const midi = pitchToMidi(stepM[1], parseInt(octM[1], 10), alter);
          const tieStop = /<tie type="stop"\s*\/>/.test(block);
          const tieStart = /<tie type="start"\s*\/>/.test(block);
          if (tieStop && openTies.has(midi)) {
            const idx = openTies.get(midi);
            notes[idx].durationTicks = (measureStart + start + duration) - notes[idx].ticks;
            if (!tieStart) openTies.delete(midi);
          } else {
            notes.push({ ticks: measureStart + start, durationTicks: duration, midi });
            if (tieStart) openTies.set(midi, notes.length - 1);
          }
        }
      }
      if (!isChord) { prevStart = start; cursor += duration; }
    }
    measureStart += barTicks;
  }
  return { ppq: divisions, timeSig: [beats, beatType], notes };
}

/** Flatten a brick's <miscellaneous-field> elements into a name→value map. */
export function readBrickMeta(xml) {
  const meta = {};
  if (typeof xml !== 'string') return meta;
  const re = /<miscellaneous-field name="([^"]+)">([\s\S]*?)<\/miscellaneous-field>/g;
  let m;
  while ((m = re.exec(xml)) !== null) meta[m[1]] = m[2];
  return meta;
}

export default { musicXmlToNotes, readBrickMeta };
