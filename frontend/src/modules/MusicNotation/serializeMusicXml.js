// serializeMusicXml.js — Score model → MusicXML string. Inverse of parseMusicXml.
// Pure string-building (on the engrave hot path). Emits <divisions>=score.divisions.

import { noteDivisions } from '#frontend/modules/Piano/PianoKiosk/modes/Composer/model/note.js';

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
function notationsXml(note) {
  const { tied } = tieMarks(note.tie);
  const arts = (note.articulations && note.articulations.length)
    ? `<articulations>${note.articulations.map((a) => `<${a}/>`).join('')}</articulations>`
    : '';
  const inner = `${tied}${arts}`;
  return inner ? `<notations>${inner}</notations>` : '';
}

// Dynamics render as a <direction> sibling emitted BEFORE the note.
function dynamicsXml(note) {
  return note.dynamics
    ? `<direction placement="below"><direction-type><dynamics><${note.dynamics}/></dynamics></direction-type></direction>`
    : '';
}

function noteXml(note, staves) {
  const dur = noteDivisions(note);
  const body = note.rest ? `<rest/>` : pitchXml(note.pitch);
  const dots = '<dot/>'.repeat(note.dots || 0);
  const { tie } = tieMarks(note.tie);
  const timeMod = note.triplet
    ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : '';
  // <staff> only when the part has more than one staff (keeps single-staff output unchanged).
  const staff = staves > 1 ? `<staff>${note.staff}</staff>` : '';
  return `<note>${note.chord ? '<chord/>' : ''}${body}`
    + `<duration>${dur}</duration>${tie}`
    + `<type>${note.type}</type>${dots}`
    + timeMod
    + staff
    + notationsXml(note)
    + (note.lyric ? `<lyric><text>${esc(note.lyric)}</text></lyric>` : '')
    + `</note>`;
}

function attributesXml(score, part) {
  // MusicXML <attributes> child order: divisions, key, time, staves, clef.
  const staves = part.staves > 1 ? `<staves>${part.staves}</staves>` : '';
  return `<attributes>`
    + `<divisions>${score.divisions}</divisions>`
    + `<key><fifths>${score.key.fifths}</fifths><mode>${score.key.mode ?? 'major'}</mode></key>`
    + `<time><beats>${score.timeSig.beats}</beats><beat-type>${score.timeSig.beatType}</beat-type></time>`
    + staves
    + `<clef><sign>${score.clef.sign}</sign><line>${score.clef.line}</line></clef>`
    + `</attributes>`;
}

// Render a measure's notes, inserting <backup> when notes switch to a different
// staff so the time cursor rewinds to the start of the leaving staff's content.
function notesXml(measure, staves) {
  let out = '';
  let prevStaff = null;
  let sectionElapsed = 0; // divisions written since measure start or last backup
  for (const n of measure.notes) {
    if (staves > 1 && prevStaff !== null && n.staff !== prevStaff) {
      out += `<backup><duration>${sectionElapsed}</duration></backup>`;
      sectionElapsed = 0;
    }
    out += dynamicsXml(n) + noteXml(n, staves);
    if (!n.chord) sectionElapsed += noteDivisions(n); // chord notes share their root's onset
    prevStaff = n.staff;
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
