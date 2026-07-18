// serializeMusicXml.js — Score model → MusicXML string. Inverse of parseMusicXml.
// Pure string-building (on the engrave hot path).
//
// Divisions basis (finding #1): <duration> is computed via noteDivisions(), which
// always works on the 24-grid (DIVISIONS). The <divisions> attribute MUST agree
// with that basis, so we emit DIVISIONS — NOT score.divisions (the source file's
// value, which may be 1). Emitting the source value with 24-grid durations inflated
// every duration by up to 24× on reload.

import { noteDivisions, DIVISIONS } from '@/modules/MusicNotation/duration.js';

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
  // Guard (finding #7): v1 only reproduces 3-in-2 triplets. A parsed tuplet with
  // any other actual/normal ratio would be silently rewritten as a plain (or
  // triplet) note on save — data loss. Refuse loudly instead. Composer-created
  // triplets carry note.triplet with NO note.tuplet, so this never fires on them.
  if (note.tuplet) {
    const { actual, normal } = note.tuplet;
    if (!(actual === 3 && normal === 2)) {
      throw new Error('only 3:2 triplets are supported in v1 (would corrupt other tuplets on save)');
    }
  }
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
  // <divisions> MUST be DIVISIONS to match the 24-grid <duration> values (finding #1).
  const staves = part.staves > 1 ? `<staves>${part.staves}</staves>` : '';
  // <mode> is optional in MusicXML; only emit it when the model carries one. A
  // parsed score with no <mode> keeps mode:null and must round-trip as null — NOT
  // be rewritten to 'major' (a silent modality change on save).
  const mode = score.key.mode ? `<mode>${score.key.mode}</mode>` : '';
  return `<attributes>`
    + `<divisions>${DIVISIONS}</divisions>`
    + `<key><fifths>${score.key.fifths}</fifths>${mode}</key>`
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
  // A bare <direction> with no <direction-type> child is schema-invalid. Wrap the
  // tempo in a <metronome> direction-type (and keep the <sound tempo> the parser
  // reads) so the emitted MusicXML validates and the tempo still round-trips.
  const tempo = isFirst
    ? `<direction placement="above">`
      + `<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome></direction-type>`
      + `<sound tempo="${score.tempo}"/>`
      + `</direction>`
    : '';
  const notes = notesXml(measure, part.staves);
  return `<measure number="${measure.number}">${attrs}${tempo}${notes}</measure>`;
}

// Guard (finding #5): the parser folds <attributes> changes to score-level
// last-wins, and the serializer only emits attributes on measure 1. So a score
// with a mid-piece key/time change would BOTH collapse the modulation AND rewrite
// the opening key on save. Detect it and refuse loudly. A Composer-created v1 file
// never sets per-measure attributes, so this only fires on exotic imports.
function assertNoMidPieceChanges(score) {
  const measures = score.parts[0].measures;
  if (measures.length < 2) return;
  const first = measures[0].attributes;
  const firstKey = first?.key ?? score.key;
  const firstTime = first?.time ?? score.timeSig;
  for (let i = 1; i < measures.length; i++) {
    const a = measures[i].attributes;
    if (!a) continue;
    const keyDiff = a.key && firstKey && a.key.fifths !== firstKey.fifths;
    const timeDiff = a.time && firstTime
      && (a.time.beats !== firstTime.beats || a.time.beatType !== firstTime.beatType);
    if (keyDiff || timeDiff) {
      throw new Error('mid-piece key/time changes are not supported in v1 (would corrupt on save)');
    }
  }
}

export function serializeMusicXml(score) {
  // Guard (finding #4): v1 serializes only parts[0]. A multi-part score would
  // silently drop every part after the first — refuse loudly instead.
  if (score.parts.length > 1) {
    throw new Error('multi-part scores are not supported in v1 (would drop parts on save)');
  }
  assertNoMidPieceChanges(score);

  const part = score.parts[0];
  const measures = part.measures.map((m, i) => measureXml(score, part, m, i === 0)).join('');
  // Omit <work>/<work-title> entirely when the title is empty/nullish so a reloaded
  // title never becomes the literal string "null".
  const workTitle = score.title != null && score.title !== ''
    ? `<work><work-title>${esc(score.title)}</work-title></work>` : '';
  // Preserve the parsed part name instead of hardcoding "Music".
  const partName = esc(part.name ?? 'Music');
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<score-partwise version="3.1">`
    + workTitle
    + `<identification><creator type="composer">${esc(score.composerName)}</creator></identification>`
    + `<part-list><score-part id="${part.id}"><part-name>${partName}</part-name></score-part></part-list>`
    + `<part id="${part.id}">${measures}</part>`
    + `</score-partwise>`;
}
