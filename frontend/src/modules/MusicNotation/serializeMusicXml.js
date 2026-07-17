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

// Assemble a single <notations> block (tied for now; grows with articulations).
// Emit nothing when there is no content (never an empty <notations/>).
function notationsXml(note) {
  const { tied } = tieMarks(note.tie);
  const inner = `${tied}`;
  return inner ? `<notations>${inner}</notations>` : '';
}

function noteXml(note) {
  const dur = noteDivisions(note);
  const body = note.rest ? `<rest/>` : pitchXml(note.pitch);
  const dots = '<dot/>'.repeat(note.dots || 0);
  const { tie } = tieMarks(note.tie);
  return `<note>${note.chord ? '<chord/>' : ''}${body}`
    + `<duration>${dur}</duration>${tie}`
    + `<type>${note.type}</type>${dots}`
    + notationsXml(note)
    + `</note>`;
}

function attributesXml(score) {
  return `<attributes>`
    + `<divisions>${score.divisions}</divisions>`
    + `<key><fifths>${score.key.fifths}</fifths><mode>${score.key.mode ?? 'major'}</mode></key>`
    + `<time><beats>${score.timeSig.beats}</beats><beat-type>${score.timeSig.beatType}</beat-type></time>`
    + `<clef><sign>${score.clef.sign}</sign><line>${score.clef.line}</line></clef>`
    + `</attributes>`;
}

function measureXml(score, measure, isFirst) {
  const attrs = isFirst ? attributesXml(score) : '';
  const tempo = isFirst
    ? `<direction placement="above"><sound tempo="${score.tempo}"/></direction>` : '';
  const notes = measure.notes.map(noteXml).join('');
  return `<measure number="${measure.number}">${attrs}${tempo}${notes}</measure>`;
}

export function serializeMusicXml(score) {
  const part = score.parts[0];
  const measures = part.measures.map((m, i) => measureXml(score, m, i === 0)).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<score-partwise version="3.1">`
    + `<work><work-title>${esc(score.title)}</work-title></work>`
    + `<identification><creator type="composer">${esc(score.composerName)}</creator></identification>`
    + `<part-list><score-part id="${part.id}"><part-name>Music</part-name></score-part></part-list>`
    + `<part id="${part.id}">${measures}</part>`
    + `</score-partwise>`;
}
