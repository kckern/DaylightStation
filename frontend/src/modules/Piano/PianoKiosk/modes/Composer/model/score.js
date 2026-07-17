// score.js — Score document factory.
import { DIVISIONS } from '#frontend/modules/MusicNotation/duration.js';

export function makeEmptyScore(setup = {}) {
  const clef = setup.clef ?? { sign: 'G', line: 2 };
  return {
    title: setup.title ?? 'Untitled',
    composerName: setup.composerName ?? '',
    tempo: setup.tempo ?? 100,
    timeSig: setup.time ?? { beats: 4, beatType: 4 },
    key: { fifths: setup.key?.fifths ?? 0, mode: setup.key?.mode ?? 'major' },
    // clef is a convenience mirror of staff-1's clef; part.clefs (keyed by staff
    // number, matching the parser's shape) is the AUTHORITATIVE representation the
    // serializer reads. Keep the two in sync here.
    clef: { ...clef },
    divisions: DIVISIONS,
    parts: [{ id: 'P1', staves: 1, clefs: { 1: { ...clef } }, measures: [{ number: 1, notes: [] }] }],
  };
}
