// Built-in (bundled) sheet-music scores — MusicXML shipped with the app, shown
// in the Sheet Music grid alongside the Plex collection. Selecting one opens the
// interactive ScorePlayer (engraved via the MusicNotation framework) rather than
// the page-image ScoreViewer used for scanned Plex scores.
import maryXml from '../../../../MusicNotation/scores/maryHadALittleLamb.musicxml?raw';

export const BUILTIN_SCORES = [
  {
    id: 'mary',
    title: 'Mary Had a Little Lamb',
    builtin: true,
    musicXml: maryXml,
  },
];

export function getBuiltinScore(id) {
  return BUILTIN_SCORES.find((s) => s.id === id) || null;
}

export default BUILTIN_SCORES;
