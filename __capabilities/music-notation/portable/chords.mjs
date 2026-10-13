// Chord-symbol parsing for the MIDI loop library + theory UX. Pure, no DOM.
//
// Turns a written chord symbol ("Dm", "BbSus2", "FMaj9") into a root pitch-class
// (0..11, C=0) plus a coarse triad quality. Extensions (7, 9, 11, add-tones) are
// intentionally collapsed to the underlying triad quality — the loop matcher and
// roman-numeral analysis care about root + major/minor/dim/aug/sus, not the colour.

/** Pitch-class for each spelled root name. C = 0. Includes the awkward
 *  enharmonics (Cb, Fb, E#, B#) that show up in flat-key progressions. */
export const PITCH_CLASS = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0,
};

/**
 * Parse a chord symbol into { root, quality, symbol } or null if unparseable.
 * @param {string} symbol e.g. "Dm", "Bb", "Gm7", "BbSus2", "Gm(add4)"
 */
export function parseChordSymbol(symbol) {
  if (typeof symbol !== 'string') return null;
  const sym = symbol.trim();
  const m = sym.match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return null;

  const [, letter, accidental, rest] = m;
  const root = PITCH_CLASS[letter + accidental];
  if (root === undefined) return null;

  return { root, quality: qualityOf(rest), symbol: sym };
}

/** Map the post-root remainder to a triad quality. */
function qualityOf(rest) {
  const r = rest.trim();
  if (/dim|°/i.test(r)) return 'diminished';
  if (/aug|\+/i.test(r)) return 'augmented';
  if (/sus2/i.test(r)) return 'sus2';
  if (/sus(4)?/i.test(r)) return 'sus4'; // bare "sus" = sus4
  if (/^maj/i.test(r)) return 'major'; // Maj7/Maj9 — major triad with colour
  if (/^m(?!aj)/.test(r) || /^min/i.test(r)) return 'minor'; // leading lowercase m (not "maj")
  return 'major';
}

export default parseChordSymbol;
