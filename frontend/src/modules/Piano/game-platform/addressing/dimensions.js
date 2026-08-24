/**
 * The dimensions of "which key means which place on the board".
 *
 * Every one of these was a constant buried in a game's source: chess hard-coded
 * `grand` clefs and one octave of naturals, checkers inherited them, Connect
 * Four picked seven notes of its own. `addressing.shuffle` gives every game the
 * same three-value cadence dimension.
 *
 * Naming them is what lets them become configuration: a house default, a rung on
 * a ladder, and a per-player override, for each dimension independently.
 *
 * The full analysis — why each dimension exists, what it drills, and what makes
 * a combination legal — is docs/reference/piano/grid-addressing.md. This module
 * is that document's vocabulary, executable.
 */

/** The first fork: which skill the board asks for. */
export const VOCABULARIES = Object.freeze(['names', 'staff', 'chords']);

/** Which staff each axis is read on. Staff vocabulary only. */
export const CLEF_PAIRS = Object.freeze(['grand', 'treble-only', 'bass-only', 'inverted']);

/**
 * How an axis is laid out.
 *
 * `sequential` is a scale — the thing being learnt. `reverse` is the same scale
 * read downward, which is its own drill: a player who has memorised "left is
 * low" reads a descending axis with real effort the first few times, and it is a
 * far gentler step than a full shuffle because the INTERVALS are all still where
 * they were. `shuffled` is a reading test, with nothing left to lean on.
 */
export const ORDERS = Object.freeze(['sequential', 'reverse', 'shuffled']);

/**
 * How much the bass note matters — the inversion knob.
 *
 * Chord matching is on the pitch-class SET, so by default voicing, octave and
 * doublings are free and an inversion costs nothing: C-E-G, E-G-C and G-C-E all
 * address the same square. That is the right floor, and it is also a whole skill
 * left untaught.
 *
 *   `any`   — the shipped behaviour. Any voicing of the right notes is the right
 *             answer; the bass only breaks ties between ambiguous sets.
 *   `root`  — root position required. The named root must be the lowest note, so
 *             the player has to decide which note that is and put it under their
 *             thumb, rather than grabbing the shape nearest their hand.
 *   `named` — the rim names the inversion it wants (`Cm/G`) and the player must
 *             put THAT note in the bass. The address is now (root, quality,
 *             bass), which is the full slash-chord vocabulary.
 *
 * Staff vocabulary ignores this: a two-note address has no inversion to have an
 * opinion about.
 */
export const INVERSIONS = Object.freeze(['any', 'root', 'named']);

/** When the map moves. `each_turn` is materially harder than `each_game`. */
export const CADENCES = Object.freeze(['never', 'each_game', 'each_turn']);

export const MIN_TIER = 0;
export const MAX_TIER = 5;

/**
 * The pitch material each tier makes available, as MIDI notes, low to high.
 *
 * An axis takes the first N it needs. A tier whose pool is smaller than the axis
 * cannot be used for that axis, and `resolveAddressing` raises the tier rather
 * than silently dealing a short axis — an axis with fewer notes than slots
 * leaves squares no key can ever address, which looks exactly like a broken
 * game.
 *
 * The pools stay CONTIGUOUS with their neighbour axis wherever possible: the
 * grand-staff default runs bass B2→B3 and treble C4→C5 with no gap, so no note
 * within the player's reach belongs to neither axis. A note that addresses
 * nothing is the most confusing possible outcome of a correct guess.
 */
export const STAFF_TIERS = Object.freeze({
  // A five-finger position. Enough for Connect Four's seven columns only from
  // tier 1 up; enough for a 5-wide axis here.
  0: Object.freeze({ treble: [60, 62, 64, 65, 67], bass: [53, 55, 57, 59, 60] }),
  // One octave of naturals — a first reading method, exactly.
  1: Object.freeze({ treble: [60, 62, 64, 65, 67, 69, 71, 72], bass: [47, 48, 50, 52, 53, 55, 57, 59] }),
  // The shipped default. Same material as tier 1; the difficulty at this rung
  // comes from using BOTH clefs at once, which `clefs: grand` is what says.
  2: Object.freeze({ treble: [60, 62, 64, 65, 67, 69, 71, 72], bass: [47, 48, 50, 52, 53, 55, 57, 59] }),
  // Naturals plus one accidental per axis — the same hinge the chord scheme
  // uses when it runs out of letters and takes B flat.
  3: Object.freeze({ treble: [60, 62, 64, 65, 67, 69, 70, 71], bass: [47, 48, 50, 52, 53, 55, 56, 57] }),
  // Diatonic in a key other than C. F major (one flat) is the gentlest step.
  4: Object.freeze({ treble: [60, 62, 64, 65, 67, 69, 70, 72], bass: [46, 48, 50, 52, 53, 55, 57, 58] }),
  // Chromatic. Every semitone is in play; the axis takes a slice.
  5: Object.freeze({
    treble: [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71],
    bass: [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59],
  }),
});

/**
 * Chord roots per tier, and the qualities available to the rank axis.
 *
 * Roots climb from the three primary chords a first lesson teaches to the full
 * chromatic. B flat appears at tier 2 because it is FORCED, not decorative: the
 * scheme needs eight distinct roots and the alphabet supplies seven letters
 * before repeating C, so file `h` takes the one flat in the set. That exception
 * is the natural hinge into tier 3 — a player who has accepted one black root
 * finds a second a small step rather than a new idea.
 *
 * Qualities are ordered roughly by difficulty, so rank 1 — White's home rank,
 * where the first lesson lives — is plain major triads. The set is chosen so no
 * two squares are the same notes; see `validateChordScheme` for the three
 * seductive qualities that make that impossible (augmented, sus2/sus4,
 * add6/minor7).
 */
export const CHORD_TIERS = Object.freeze({
  0: Object.freeze({ roots: ['C', 'F', 'G'], qualities: ['major', 'minor', 'sus4'] }),
  1: Object.freeze({
    roots: ['C', 'D', 'E', 'F', 'G'],
    qualities: ['major', 'minor', 'sus4', 'seventh', 'add9'],
  }),
  2: Object.freeze({
    roots: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Bb'],
    qualities: ['major', 'minor', 'sus4', 'add9', 'seventh', 'add6', 'major7', 'diminished'],
  }),
  3: Object.freeze({
    roots: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Eb'],
    qualities: ['major', 'minor', 'sus4', 'add9', 'seventh', 'add6', 'major7', 'diminished'],
  }),
  4: Object.freeze({
    roots: ['A', 'Bb', 'C', 'D', 'Eb', 'F', 'G', 'Ab'],
    qualities: ['major', 'minor', 'sus4', 'add9', 'seventh', 'add6', 'major7', 'diminished'],
  }),
  5: Object.freeze({
    roots: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
    qualities: ['major', 'minor', 'sus4', 'add9', 'seventh', 'add6', 'major7', 'diminished'],
  }),
});

/**
 * The addressing ladder — difficulty in READING, orthogonal to opponent strength.
 *
 * The point of separating them: a strong reader who is a weak player and a
 * strong player who cannot read are both real children, and one ladder cannot
 * serve them. A rung here is a partial config; unstated dimensions fall through
 * to the layers beneath, so a rung says only what it changes.
 */
export const ADDRESSING_RUNGS = Object.freeze([
  { rung: 1, label: 'Key names', vocabulary: 'names', x: { tier: 0 }, y: { tier: 0 }, shuffle: 'never' },
  { rung: 2, label: 'One clef', vocabulary: 'staff', clefs: 'treble-only', x: { tier: 1 }, y: { tier: 1 }, shuffle: 'never' },
  { rung: 3, label: 'Both clefs', vocabulary: 'staff', clefs: 'grand', x: { tier: 2 }, y: { tier: 2 }, shuffle: 'never' },
  // Reverse before shuffle: the intervals are all still where they were, so it
  // is a real step without throwing away everything the player has to lean on.
  { rung: 4, label: 'Read it backwards', vocabulary: 'staff', clefs: 'grand', x: { tier: 2, order: 'reverse' }, y: { tier: 2, order: 'reverse' }, shuffle: 'never' },
  { rung: 5, label: 'Read, don’t memorise', vocabulary: 'staff', clefs: 'grand', x: { tier: 2, order: 'shuffled' }, y: { tier: 2, order: 'shuffled' }, shuffle: 'each_game' },
  { rung: 6, label: 'Accidentals', vocabulary: 'staff', clefs: 'grand', x: { tier: 3, order: 'shuffled' }, y: { tier: 3, order: 'shuffled' }, shuffle: 'each_game' },
  { rung: 7, label: 'A new key, every turn', vocabulary: 'staff', clefs: 'grand', x: { tier: 4, order: 'shuffled' }, y: { tier: 4, order: 'shuffled' }, shuffle: 'each_turn' },
  { rung: 8, label: 'First triads', vocabulary: 'chords', x: { tier: 0 }, y: { tier: 0 }, shuffle: 'never', inversions: 'any' },
  { rung: 9, label: 'The full vocabulary', vocabulary: 'chords', x: { tier: 2 }, y: { tier: 2 }, shuffle: 'never', inversions: 'any' },
  { rung: 10, label: 'Root in the bass', vocabulary: 'chords', x: { tier: 2 }, y: { tier: 2 }, shuffle: 'never', inversions: 'root' },
  { rung: 11, label: 'Spell, don’t memorise', vocabulary: 'chords', x: { tier: 2, order: 'shuffled' }, y: { tier: 2, order: 'shuffled' }, shuffle: 'each_game', inversions: 'root' },
  { rung: 12, label: 'Slash chords', vocabulary: 'chords', x: { tier: 2, order: 'shuffled' }, y: { tier: 2, order: 'shuffled' }, shuffle: 'each_game', inversions: 'named' },
  { rung: 13, label: 'Black roots, every turn', vocabulary: 'chords', x: { tier: 4, order: 'shuffled' }, y: { tier: 4, order: 'shuffled' }, shuffle: 'each_turn', inversions: 'named' },
]);

export const MIN_RUNG = 1;
export const MAX_RUNG = ADDRESSING_RUNGS.length;

/** The house floor, before any game, rung or player has said anything. */
export const ADDRESSING_DEFAULTS = Object.freeze({
  vocabulary: 'staff',
  clefs: 'grand',
  x: Object.freeze({ tier: 2, order: 'sequential' }),
  y: Object.freeze({ tier: 2, order: 'sequential' }),
  shuffle: 'never',
  inversions: 'any',
  scheme: null,
});

export function rungAt(rung) {
  return ADDRESSING_RUNGS.find((entry) => entry.rung === rung) ?? null;
}
