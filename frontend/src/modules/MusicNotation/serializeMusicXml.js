// serializeMusicXml.js — Score model → MusicXML string. Inverse of parseMusicXml.
// Pure string-building (on the engrave hot path). Emits <divisions>=score.divisions.

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

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
  const notes = ''; // filled in by later tasks
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
