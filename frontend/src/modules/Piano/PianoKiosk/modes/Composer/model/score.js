// score.js — Score document factory.
import { DIVISIONS } from '#frontend/modules/MusicNotation/duration.js';

export function makeEmptyScore(setup = {}) {
  return {
    title: setup.title ?? 'Untitled',
    composerName: setup.composerName ?? '',
    tempo: setup.tempo ?? 100,
    timeSig: setup.time ?? { beats: 4, beatType: 4 },
    key: { fifths: setup.key?.fifths ?? 0, mode: setup.key?.mode ?? 'major' },
    clef: setup.clef ?? { sign: 'G', line: 2 },
    divisions: DIVISIONS,
    parts: [{ id: 'P1', staves: 1, measures: [{ number: 1, notes: [] }] }],
  };
}
