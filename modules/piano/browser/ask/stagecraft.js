/**
 * stagecraft — the geometry and theory an ask's PRESENTATION leans on: which
 * clef an ask or an instance belongs on, which accidental spelling a key
 * wants, and whether the one-staff sequence renderer can draw a given
 * instance honestly.
 *
 * Moved verbatim from `PianoKiosk/modes/Exercises/runPresentation.js` (task 2
 * of the ask-platform SP1 plan): these are pure theory/geometry helpers with
 * no opinion about tiers or stages, so they belong under the schema rather
 * than under one host's presentation module.
 * `PianoKiosk/modes/Exercises/runPresentation.js` re-exports every one of
 * these unchanged, so nothing that already imports them has to move.
 *
 * Pure module: no imports, no React, no fetching, no logging, no throwing.
 */

/**
 * Which way black keys are spelled on a staff, from the key the material is in.
 *
 * `SvgSequenceStaff`'s own default is `'sharp'`, which renders the B♭ of F
 * major as A♯ — the wrong letter, on the one surface a child is reading letters
 * from. A key that cannot be read falls back to sharps rather than to
 * `spellAccidental`'s no-argument coin flip, which on a kiosk means the same
 * note flickering between spellings between renders.
 *
 * The rule is the key signature's own: a tonic spelled with a flat is a flat
 * key; a tonic spelled with a sharp is a sharp key; and of the naturals, F
 * major and the D/G/C/F minors carry flats. Quality matters — D major has two
 * sharps and D minor has one flat, and the letter alone cannot tell them apart.
 *
 * @param {string|null} key e.g. `'F'`, `'Bb'`, `'B♭'`, `'D minor'`, `'Dm'`.
 * @returns {'sharp'|'flat'}
 */
export function accidentalForKey(key) {
  if (typeof key !== 'string') return 'sharp';
  const text = key.trim();
  const letter = text.charAt(0).toUpperCase();
  // The length check is not redundant: `'ABCDEFG'.includes('')` is true, so an
  // empty key would otherwise fall through and be answered as F major.
  if (letter.length !== 1 || !'ABCDEFG'.includes(letter)) return 'sharp';
  const rest = text.slice(1);
  const sign = rest.charAt(0);
  if (sign === 'b' || sign === '♭') return 'flat';
  if (sign === '#' || sign === '♯') return 'sharp';
  const quality = rest.trim().toLowerCase();
  const minor = quality === 'm' || quality.startsWith('min') || quality === 'aeolian';
  return (minor ? 'DGCF' : 'F').includes(letter) ? 'flat' : 'sharp';
}

/**
 * Which DEGREE of a major scale each mode or chord quality is built on.
 *
 * That degree is the whole rule: a mode standing on degree n of a major scale
 * carries that major scale's key signature, so G dorian (degree 2) is F major's
 * one flat and G mixolydian (degree 5) is C major's none. Both vocabularies the
 * bank publishes are here — `axes.mode` for `scales/modes` (all ten of its
 * values) and `axes.quality` for `chords/triads` and `chords/sevenths` — because
 * they answer the same question and a second table would drift from this one.
 * The scale seed currently publishes thirteen modes: harmonic and melodic
 * minor share Aeolian's signature (their raised degrees are written as local
 * accidentals), while chromatic deliberately falls back to its tonic spelling.
 *
 * The chord entries are read the same way: a minor triad's flat third is the
 * relative major's, a dominant 7th's flat seventh is mixolydian's, and a
 * half-diminished 7th's is locrian's. An augmented triad's raised fifth is not
 * in any signature, so it stays on its own tonic (degree 1) and spells sharp,
 * which is what C-E-G♯ wants.
 */
const DEGREE_OF = Object.freeze({
  // scales/modes
  ionian: 1,
  dorian: 2,
  phrygian: 3,
  lydian: 4,
  mixolydian: 5,
  aeolian: 6,
  locrian: 7,
  'major-pentatonic': 1,
  'minor-pentatonic': 6,
  blues: 6,
  // chords/triads, chords/sevenths
  major: 1,
  'major-7th': 1,
  augmented: 1,
  'minor-7th': 2,
  'dominant-7th': 5,
  minor: 6,
  'natural-minor': 6,
  'harmonic-minor': 6,
  'melodic-minor': 6,
  diminished: 7,
  'half-diminished-7th': 7,
  'diminished-7th': 7,
});

const LETTERS = 'CDEFGAB';
/** Semitones above C for each natural letter, and for each degree of a major scale. */
const LETTER_SEMITONE = Object.freeze([0, 2, 4, 5, 7, 9, 11]);
const DEGREE_SEMITONE = Object.freeze([0, 2, 4, 5, 7, 9, 11]);

/**
 * The key whose SIGNATURE a bank instance carries, named as a major tonic.
 *
 * The bank writes `instance.key` as the ROOT PITCH CLASS ALONE — `'D'`, never
 * `'D minor'` — and puts the flavour on a separate axis (`axes.mode` /
 * `axes.quality`). So `accidentalForKey(instance.key)` on its own can never see
 * anything but a major tonic: every D minor instance would be spelled with D
 * major's two sharps and its B♭ drawn as A♯, and every G dorian one likewise.
 *
 * This re-joins the two halves the bank splits by walking back to the relative
 * major — letter and semitone together, so the tonic comes out spelled rather
 * than merely pitched (C aeolian resolves to `'Eb'`, not `'D#'`). The one
 * accidental rule then stays in `accidentalForKey`, which is the point: this
 * function decides WHICH key, never which accidental.
 *
 * Anything it cannot read — an unknown flavour, a root that is not a letter
 * with at most one accidental — returns the root unchanged rather than a guess,
 * which is exactly today's answer for plain major material (F major's `'F'`
 * already resolves to flats).
 */
export function instanceKeySignature(instance) {
  const raw = typeof instance?.key === 'string' ? instance.key.trim() : '';
  if (!raw) return null;
  const axes = instance?.axes ?? {};
  const degree = DEGREE_OF[String(axes.mode ?? axes.quality ?? '').trim().toLowerCase()];
  if (!degree || degree === 1) return raw;

  const letterIndex = LETTERS.indexOf(raw.charAt(0).toUpperCase());
  if (letterIndex < 0) return raw;
  const sign = raw.charAt(1);
  const shift = (sign === 'b' || sign === '♭') ? -1 : ((sign === '#' || sign === '♯') ? 1 : 0);
  // A root is a letter plus at most one accidental. Anything longer is a key
  // this cannot read, and reading it wrong is worse than not reading it.
  if (raw.length > (shift ? 2 : 1)) return raw;

  const rootSemitone = (LETTER_SEMITONE[letterIndex] + shift + 12) % 12;
  const tonicLetter = (letterIndex - (degree - 1) + 14) % 7;
  const tonicSemitone = (rootSemitone - DEGREE_SEMITONE[degree - 1] + 12) % 12;
  // How far that tonic sits from its own natural letter, folded into [-6, 5].
  const delta = ((tonicSemitone - LETTER_SEMITONE[tonicLetter] + 18) % 12) - 6;
  if (Math.abs(delta) > 2) return raw; // beyond a double accidental: unreadable
  const accidental = (delta < 0 ? 'b' : '#').repeat(Math.abs(delta));
  return `${LETTERS[tonicLetter]}${accidental}`;
}

/**
 * The pitch windows one staff holds without ledger lines nobody can count.
 * Treble: C4 (one ledger below) up to A5 (one ledger above). Bass: E2 up to C4.
 * An ask that fits inside one of these windows is an ask that renders legibly.
 */
const TREBLE_WINDOW = [60, 81];
const BASS_WINDOW = [40, 60];
/** A reinforcement staff is for an ask a child can take in at once. */
export const MAX_ASK_SPAN = 12;

/**
 * Every midi in an ask, in event order. Exported: `staffFitsAsk` (which stays
 * in `runPresentation.js` — an ExerciseRun-only concern) shares this reading
 * of an event list with `clefForAsk` below, and re-deriving it there would be
 * a second place for the two to drift apart.
 */
export function askMidis(events) {
  return (events ?? []).flatMap((event) => (event?.notes ?? [])
    .map((note) => note?.midi)
    .filter((midi) => Number.isFinite(midi)));
}

const within = ([low, high], midis) => midis.every((midi) => midi >= low && midi <= high);

/**
 * The one clef this ask belongs on, or `null` when no single clef holds it.
 * Treble wins a tie (an ask of C4 alone), matching "C4 and above is treble".
 */
export function clefForAsk(events) {
  const midis = askMidis(events);
  if (!midis.length) return null;
  if (within(TREBLE_WINDOW, midis)) return 'treble';
  if (within(BASS_WINDOW, midis)) return 'bass';
  return null;
}

/**
 * The clef an instance's own notation declares, when it declares one: an
 * explicit `staff`, else the hand every note is played by. Material that spans
 * both hands returns `null` and lets the renderer decide by majority — one
 * sequence staff cannot be two staves.
 */
export function clefForInstance(instance) {
  const declared = instance?.staff;
  if (declared === 'treble' || declared === 'bass') return declared;
  const hands = new Set();
  for (const event of instance?.events ?? []) {
    for (const note of event?.notes ?? []) hands.add(note?.hand ?? null);
  }
  if (hands.size !== 1) return null;
  const [hand] = [...hands];
  if (hand === 'right') return 'treble';
  if (hand === 'left') return 'bass';
  return null;
}

/**
 * The pitch band ONE staff holds. `SvgSequenceStaff` is 112 view units tall
 * whatever it is handed — staff positions -3 to 11, B3 to B5 on a treble
 * clef, a hair over two octaves. Ink outside that band is drawn anyway, off
 * the card, with nothing on screen to say so.
 */
const SEQUENCE_STAFF_SPAN = 24;

/**
 * Can the one-staff sequence renderer draw this material HONESTLY?
 *
 * Three ways it cannot, and each one is a different kind of dishonest:
 *
 *  - **`staff: 'grand'`.** The material's own notation declares two staves.
 *    Drawing it on one is drawing something the author said it is not.
 *  - **Genuinely two-hand.** One hand, one staff — the engraving rule this
 *    redesign is accountable to. Two hands collapsed onto a single clef puts
 *    the left hand's notes wherever the right hand's clef happens to place
 *    them, which is not the piece.
 *  - **A span past one staff's band.** Even one-handed, an ask reaching further
 *    than `SEQUENCE_STAFF_SPAN` runs off a box that cannot grow to hold it.
 *
 * `drills/hanon/001` is all three at once — `staff: grand`, both hands, midi 36
 * to 91 — and it is the material this predicate exists for: 42% of its notes
 * rendered off-canvas on a single treble clef at a 20:1 aspect ratio, where the
 * ABC path had drawn a correct grand staff. Material this answers `false` for
 * keeps that path.
 *
 * Material with no notes answers `true`: there is nothing to draw wrongly, and
 * the empty-ask behaviour is not this predicate's to change.
 */
export function sequenceStaffCanDraw(instance) {
  const declared = typeof instance?.staff === 'string' ? instance.staff.trim().toLowerCase() : '';
  if (declared !== '' && declared !== 'treble' && declared !== 'bass') return false;
  const hands = new Set();
  for (const event of instance?.events ?? []) {
    for (const note of event?.notes ?? []) if (note?.hand) hands.add(note.hand);
  }
  if (hands.size > 1) return false;
  const midis = askMidis(instance?.events);
  if (!midis.length) return true;
  return Math.max(...midis) - Math.min(...midis) <= SEQUENCE_STAFF_SPAN;
}
