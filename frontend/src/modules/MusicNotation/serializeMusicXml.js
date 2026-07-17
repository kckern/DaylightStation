// serializeMusicXml.js — Score model → MusicXML string. Inverse of parseMusicXml.
// Pure string-building (on the engrave hot path). Emits <divisions>=score.divisions.

import { noteDivisions } from '#frontend/modules/MusicNotation/duration.js';

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function pitchXml(p) {
  return `<pitch><step>${p.step}</step>`
    + (p.alter ? `<alter>${p.alter}</alter>` : '')
    + `<octave>${p.octave}</octave></pitch>`;
}

// Tie: <tie> element (sound) goes between <duration> and <type>;
// <tied> element (notation) goes in <notations>.
function tieMarks(tie) {
  if (tie === 'start') return { tie: '<tie type="start"/>', tied: '<tied type="start"/>' };
  if (tie === 'stop') return { tie: '<tie type="stop"/>', tied: '<tied type="stop"/>' };
  if (tie === 'both') return { tie: '<tie type="stop"/><tie type="start"/>', tied: '<tied type="stop"/><tied type="start"/>' };
  return { tie: '', tied: '' };
}

// Assemble a single <notations> block from tied + articulations.
// Emit nothing when there is no content (never an empty <notations/>).
// `tied` is precomputed by the caller (see tieMarks) to avoid recomputing it.
function notationsXml(note, tied) {
  // assumes controlled MusicXML vocabulary (articulation names emitted as tag names)
  const arts = (note.articulations && note.articulations.length)
    ? `<articulations>${note.articulations.map((a) => `<${a}/>`).join('')}</articulations>`
    : '';
  const inner = `${tied}${arts}`;
  return inner ? `<notations>${inner}</notations>` : '';
}

// Dynamics render as a <direction> sibling emitted BEFORE the note.
// TODO: add <staff> child when multi-staff dynamics are exercised
function dynamicsXml(note) {
  // assumes controlled MusicXML vocabulary (dynamics name emitted as tag name)
  return note.dynamics
    ? `<direction placement="below"><direction-type><dynamics><${note.dynamics}/></dynamics></direction-type></direction>`
    : '';
}

// `dur`, `tie`, `tied` are precomputed once by the caller (hot path — avoids a
// second noteDivisions()/tieMarks() per note).
function noteXml(note, staves, dur, tie, tied) {
  const body = note.rest ? `<rest/>` : pitchXml(note.pitch);
  const dots = '<dot/>'.repeat(note.dots || 0);
  const timeMod = note.triplet
    ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : '';
  // <staff> only when the part has more than one staff (keeps single-staff output unchanged).
  const staff = staves > 1 ? `<staff>${note.staff}</staff>` : '';
  // MusicXML child order: … duration, tie, VOICE, type, dot, time-modification,
  // stem, staff, notations, lyric. <voice> is emitted for every note (default 1)
  // so the bass-staff voice round-trips — dropping it is the I2 data-loss bug.
  // NOTE: <stem> is intentionally NOT serialized — it is presentational and
  // auto-computed by the engraver, so we don't round-trip it.
  return `<note>${note.chord ? '<chord/>' : ''}${body}`
    + `<duration>${dur}</duration>${tie}`
    + `<voice>${note.voice ?? 1}</voice>`
    + `<type>${note.type}</type>${dots}`
    + timeMod
    + staff
    + notationsXml(note, tied)
    + (note.lyric ? `<lyric><text>${esc(note.lyric)}</text></lyric>` : '')
    + `</note>`;
}

// Emit one <clef> per staff from the authoritative part.clefs map (keyed by staff
// number). Sorted by staff number so a grand staff serializes staff 1 (treble)
// before staff 2 (bass). Single-staff output stays byte-identical to before: one
// lone <clef> with NO number attribute. Falls back to score.clef when the part
// carries no clefs map (defensive; initEditor/makeEmptyScore always populate one).
function clefsXml(score, part) {
  const map = part.clefs && Object.keys(part.clefs).length
    ? part.clefs
    : { 1: score.clef };
  const staffNums = Object.keys(map).map(Number).sort((a, b) => a - b);
  const single = (part.staves ?? 1) === 1 && staffNums.length === 1;
  return staffNums
    .map((n) => {
      const c = map[n];
      const numAttr = single ? '' : ` number="${n}"`;
      return `<clef${numAttr}><sign>${c.sign}</sign><line>${c.line}</line></clef>`;
    })
    .join('');
}

function attributesXml(score, part) {
  // MusicXML <attributes> child order: divisions, key, time, staves, clef.
  const staves = part.staves > 1 ? `<staves>${part.staves}</staves>` : '';
  return `<attributes>`
    + `<divisions>${score.divisions}</divisions>`
    + `<key><fifths>${score.key.fifths}</fifths><mode>${score.key.mode ?? 'major'}</mode></key>`
    + `<time><beats>${score.timeSig.beats}</beats><beat-type>${score.timeSig.beatType}</beat-type></time>`
    + staves
    + clefsXml(score, part)
    + `</attributes>`;
}

// Render a measure's notes. Multi-staff notes advance an independent write-position
// per staff; before each note we move the MusicXML time cursor to where its staff
// should resume by emitting <backup> (cursor ahead of target) or <forward> (cursor
// behind target). This is correct for ANY note order within the measure — contiguous
// staff runs OR interleaved (s1→s2→s1) — not just staff-grouped input.
function notesXml(measure, staves) {
  let out = '';
  const multi = staves > 1;
  const staffElapsed = new Map(); // staff number → divisions already written on that staff
  let cursor = 0;                 // absolute position (divisions) of the MusicXML time cursor
  for (const n of measure.notes) {
    const dur = noteDivisions(n);
    const { tie, tied } = tieMarks(n.tie);
    // Chord notes share the previous note's onset — they neither move the cursor
    // nor consume time, so they need no backup/forward and no bookkeeping.
    if (multi && !n.chord) {
      const target = staffElapsed.get(n.staff) || 0;
      if (cursor > target) out += `<backup><duration>${cursor - target}</duration></backup>`;
      else if (target > cursor) out += `<forward><duration>${target - cursor}</duration></forward>`;
      cursor = target;
    }
    out += dynamicsXml(n) + noteXml(n, staves, dur, tie, tied);
    if (!n.chord) {
      cursor += dur;
      if (multi) staffElapsed.set(n.staff, (staffElapsed.get(n.staff) || 0) + dur);
    }
  }
  return out;
}

function measureXml(score, part, measure, isFirst) {
  const attrs = isFirst ? attributesXml(score, part) : '';
  const tempo = isFirst
    ? `<direction placement="above"><sound tempo="${score.tempo}"/></direction>` : '';
  const notes = notesXml(measure, part.staves);
  return `<measure number="${measure.number}">${attrs}${tempo}${notes}</measure>`;
}

export function serializeMusicXml(score) {
  // v1: single-part scores only; multi-part (separate instruments) is out of
  // scope and would need a parts.map here.
  const part = score.parts[0];
  const measures = part.measures.map((m, i) => measureXml(score, part, m, i === 0)).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<score-partwise version="3.1">`
    + `<work><work-title>${esc(score.title)}</work-title></work>`
    + `<identification><creator type="composer">${esc(score.composerName)}</creator></identification>`
    + `<part-list><score-part id="${part.id}"><part-name>Music</part-name></score-part></part-list>`
    + `<part id="${part.id}">${measures}</part>`
    + `</score-partwise>`;
}
