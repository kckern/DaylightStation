// The rhythm recovery rung ("Tap the rhythm"): the passage's timing with no pitch asked of the child.
// Any key counts, and the engine is handed an expectation of one note per beat-event on one pitch, so the
// same timed judge, windows and count-in grade WHEN the child came in and nothing else. Pure.

import { buildTempoMap, msAtQuarter } from '../../../../../../../__capabilities/music-notation/browser/scoreTimeline.js';

/** The one pitch the rung expects, and every key played is read as. */
export const RHYTHM_MIDI = 60;

/**
 * The closest two taps may be and still be asked for as two (ms, at the take's own tempo). A trill, a
 * turn or a run of fast ornament notes is one tap here: a child cannot tap 16 notes a second on one key,
 * and the warm-up must never ask for what cannot be done.
 */
export const RHYTHM_MIN_TAP_MS = 120;

/**
 * The expectation with each event reduced to one note on `RHYTHM_MIDI` (a chord, or both hands together, is
 * one tap). Grace notes are dropped, and an event closer than `minTapMs` to the last kept one merges into
 * it (the expectation's tempo map is already the take's). Kept events carry `sourceIndex`, their index in
 * the real passage, so the score's cursor and marks still land on the right ink. Ids, onsets, spans, the
 * tempo map and the bar map are unchanged, so cursor, windows and coverage read as for the real passage.
 */
export function toRhythmExpectation(expectation, { minTapMs = RHYTHM_MIN_TAP_MS } = {}) {
  if (!expectation?.events) return expectation;
  const map = buildTempoMap(expectation.tempoMap);
  const events = [];
  let lastMs = -Infinity;
  expectation.events.forEach((event, sourceIndex) => {
    const notes = (event.notes ?? []).filter((note) => !note.grace);
    if (!notes.length && event.notes?.length) return; // an event of grace notes only
    const at = msAtQuarter(map, Number(event.onsetQuarter) || 0);
    if (notes.length && at - lastMs < minTapMs) return;
    if (notes.length) lastMs = at;
    const first = notes[0];
    events.push({ ...event, sourceIndex, notes: first ? [{ ...first, id: `${first.id}:rhythm`, midi: RHYTHM_MIDI }] : [] });
  });
  return { ...expectation, events };
}

/**
 * The keys held, as the engine should see them: while any physical key is down, `RHYTHM_MIDI` is down, stamped
 * with the earliest press among them (the moment the tap began). A second key struck while one is still held
 * is the same tap; lifting between taps is what makes the next one.
 */
export function rhythmNotes(activeNotes) {
  if (!activeNotes?.size) return activeNotes ?? new Map();
  let earliest = Infinity;
  let velocity = 1;
  for (const note of activeNotes.values()) {
    const stamp = Number(note?.timestamp);
    if (Number.isFinite(stamp) && stamp < earliest) { earliest = stamp; velocity = note?.velocity ?? 1; }
  }
  return new Map([[RHYTHM_MIDI, { velocity, ...(Number.isFinite(earliest) ? { timestamp: earliest } : {}) }]]);
}

/** The staff line a rhythm note sits on: the middle line of each clef (B4 treble, D3 bass). */
const LINE = Object.freeze({ G: { step: 'B', octave: '4' }, F: { step: 'D', octave: '3' } });

/**
 * The score drawn as rhythm only: every note on one line of its staff with an X notehead, no accidentals,
 * a chord as its first note, grace notes gone. Durations, rests, ties, bars and the tempo are untouched, so the passage,
 * the cursor and the grader line up with the real score. Pure apart from the DOM parser it is given.
 */
export function toRhythmMusicXml(xml, { DOMParser: Parser = globalThis.DOMParser, XMLSerializer: Serializer = globalThis.XMLSerializer } = {}) {
  if (typeof xml !== 'string' || !Parser || !Serializer) return xml;
  const doc = new Parser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return xml;
  for (const part of [...doc.getElementsByTagName('part')]) {
    const clefs = {};
    for (const measure of [...part.getElementsByTagName('measure')]) {
      for (const clef of [...measure.getElementsByTagName('clef')]) {
        const sign = clef.getElementsByTagName('sign')[0]?.textContent?.trim();
        clefs[clef.getAttribute('number') ?? '1'] = sign;
      }
      for (const note of [...measure.getElementsByTagName('note')]) {
        // A grace note takes no time and is never a tap: it is not drawn.
        if (note.getElementsByTagName('grace').length) { note.parentNode.removeChild(note); continue; }
        const pitch = note.getElementsByTagName('pitch')[0];
        if (!pitch) continue; // a rest stays a rest
        if (note.getElementsByTagName('chord').length) { note.parentNode.removeChild(note); continue; }
        const staff = note.getElementsByTagName('staff')[0]?.textContent?.trim() ?? '1';
        const line = LINE[clefs[staff] ?? (staff === '2' ? 'F' : 'G')] ?? LINE.G;
        for (const child of [...pitch.childNodes]) pitch.removeChild(child);
        for (const [tag, value] of [['step', line.step], ['octave', line.octave]]) {
          const element = doc.createElement(tag); element.textContent = value; pitch.appendChild(element);
        }
        for (const accidental of [...note.getElementsByTagName('accidental')]) note.removeChild(accidental);
        for (const old of [...note.getElementsByTagName('notehead')]) note.removeChild(old);
        const head = doc.createElement('notehead'); head.textContent = 'x';
        // MusicXML order: notehead follows type/dot/accidental/time-modification/stem.
        const after = [...note.childNodes].reverse().find((child) => ['type', 'dot', 'time-modification', 'stem'].includes(child.nodeName));
        if (after?.nextSibling) note.insertBefore(head, after.nextSibling); else note.appendChild(head);
      }
    }
  }
  return new Serializer().serializeToString(doc);
}
