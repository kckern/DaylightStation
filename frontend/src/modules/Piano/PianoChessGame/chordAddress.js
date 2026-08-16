import { shuffle } from '@shared-gaming/rng.mjs';
import { FILES, RANKS, isSquare } from '@shared-gaming/chess/index.mjs';
import {
  isStaffScheme, squareToStaffAddress, staffToSquare,
  identifyStaffAddress, validateStaffScheme,
} from './staffAddress.js';

/**
 * Chord addressing: every square on the board is one chord.
 *
 * This lives at the piano layer on purpose. The chess core in shared/gaming
 * knows nothing about music, MIDI, or chords — it deals in squares and moves —
 * and everything that translates an instrument into those squares belongs here,
 * where the instrument is. Swapping the piano for a gamepad should not require
 * touching a single line of chess.
 *
 * The board is 8x8 and a chord is (root, quality), so the two grids line up
 * exactly — 8 roots across the files, 8 qualities up the ranks, 64 squares, 64
 * chords, no leftovers. A move is therefore literally two chords: play the
 * square you are lifting from, then the square you are landing on.
 *
 * The chess core knows none of this. This module only translates, so the same
 * engine backs a piano kiosk, a mouse-driven school board, and an engine match.
 *
 * Files carry their own mnemonic: file `a` is A, `b` is B, and so on straight
 * down the alphabet. Only file `h` has no natural letter left, so it takes the
 * single flat in the set. That one exception is the whole trick to learning it.
 */

const PITCH_CLASSES = Object.freeze({
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
});

export const CHORD_QUALITIES = Object.freeze({
  major: { label: '', name: 'major', intervals: [0, 4, 7] },
  minor: { label: 'm', name: 'minor', intervals: [0, 3, 7] },
  sus2: { label: 'sus2', name: 'suspended 2nd', intervals: [0, 2, 7] },
  sus4: { label: 'sus4', name: 'suspended 4th', intervals: [0, 5, 7] },
  seventh: { label: '7', name: 'dominant 7th', intervals: [0, 4, 7, 10] },
  add6: { label: '6', name: 'added 6th', intervals: [0, 4, 7, 9] },
  diminished: { label: 'dim', name: 'diminished', intervals: [0, 3, 6] },
  augmented: { label: 'aug', name: 'augmented', intervals: [0, 4, 8] },
  major7: { label: 'maj7', name: 'major 7th', intervals: [0, 4, 7, 11] },
  minor7: { label: 'm7', name: 'minor 7th', intervals: [0, 3, 7, 10] },
  // The 2nd voiced above the octave, which is what a player actually plays and
  // what the chord is normally called. Its pitch classes reduce to {0,2,4,7} —
  // the same set the old "add2" spelling addressed, so the board's collision
  // arithmetic is unchanged by the name.
  add9: { label: 'add9', name: 'added 9th', intervals: [0, 4, 7, 14] },
  minor6: { label: 'm6', name: 'minor 6th', intervals: [0, 3, 7, 9] },
});

/**
 * Files a-g take their own letters; h takes B-flat, the one accidental.
 * Ranks climb roughly by difficulty, so rank 1 — White's home rank, where the
 * first lesson lives — is plain major triads.
 *
 * The eight qualities are chosen so that no two squares are the same set of
 * notes, which two otherwise appealing candidates make impossible:
 *
 *   - Augmented triads are symmetric, so C-aug and E-aug are one chord. Any
 *     eight distinct roots must contain a pair a major third apart, so an
 *     augmented rank is ambiguous no matter how the roots are chosen.
 *   - sus2 and sus4 are inversions of each other: C-sus2 and G-sus4 are the same
 *     three notes. At most one of the pair can appear.
 *   - add6 and minor7 are likewise one chord: C6 and Am7 are both C-E-G-A. Eight
 *     distinct roots must contain a minor-third pair (only six pitch classes can
 *     avoid one), so this pair always collides too.
 *
 * `findChordCollisions` is what `createChessGameState` checks a custom scheme
 * against before accepting it.
 */
export const DEFAULT_CHORD_SCHEME = Object.freeze({
  id: 'letters-by-difficulty-v1',
  roots: Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Bb']),
  qualities: Object.freeze(['major', 'minor', 'sus4', 'add9', 'seventh', 'add6', 'major7', 'diminished']),
});

export function rootPitchClass(root) {
  const pitchClass = PITCH_CLASSES[String(root)];
  return Number.isInteger(pitchClass) ? pitchClass : null;
}

/** Pitch classes of a chord, as a sorted set. Order-free, so inversions match. */
export function chordPitchClasses(root, quality) {
  const base = rootPitchClass(root);
  const definition = CHORD_QUALITIES[quality];
  if (base === null || !definition) return null;
  return [...new Set(definition.intervals.map((interval) => (base + interval) % 12))].sort((a, b) => a - b);
}

export function chordSymbol(root, quality) {
  const definition = CHORD_QUALITIES[quality];
  return definition ? `${root}${definition.label}` : null;
}

const PITCH_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * Which note this square wants in the bass, under the scheme's inversion policy.
 *
 * `any`   — no opinion. Voicing is free, which is the shipped floor.
 * `root`  — the root, always. The player has to work out which note that is and
 *           put it under their thumb rather than grabbing the nearest shape.
 * `named` — a specific chord tone, so the board's vocabulary becomes slash
 *           chords. Which tone is derived from the SQUARE, deterministically, so
 *           it survives a replay and a re-deal moves it along with everything
 *           else: file index plus rank index, modulo the number of tones the
 *           chord has. That spreads root position and both inversions evenly
 *           across the board instead of clumping them on one rank.
 */
export function requiredBass(square, chord, policy = 'any') {
  if (!chord?.pitch_classes?.length || policy === 'any') return null;
  const rootPc = rootPitchClass(chord.root);
  if (policy === 'root') return rootPc;
  const file = FILES.indexOf(square[0]);
  const rank = RANKS.indexOf(square[1]);
  if (file < 0 || rank < 0) return rootPc;
  // Ordered from the root upward, so index 0 is root position, 1 is first
  // inversion, and so on — the numbering a player is taught.
  const tones = chord.pitch_classes
    .slice()
    .sort((a, b) => ((a - rootPc + 12) % 12) - ((b - rootPc + 12) % 12));
  return tones[(file + rank) % tones.length];
}

/** `Cm` in root position; `Cm/G` when the board wants a specific bass. */
export function slashSymbol(symbol, bassPc, rootPc) {
  if (bassPc === null || bassPc === undefined || bassPc === rootPc) return symbol;
  return `${symbol}/${PITCH_NAMES[((bassPc % 12) + 12) % 12]}`;
}

export function validateChordScheme(scheme, { qualities: table = CHORD_QUALITIES } = {}) {
  if (isStaffScheme(scheme)) return validateStaffScheme(scheme);
  const errors = [];
  const roots = scheme?.roots;
  const qualities = scheme?.qualities;
  if (!Array.isArray(roots) || roots.length !== 8) errors.push('roots must list exactly eight entries, one per file');
  if (!Array.isArray(qualities) || qualities.length !== 8) errors.push('qualities must list exactly eight entries, one per rank');
  const pitchClasses = new Set();
  for (const root of roots || []) {
    const pitchClass = rootPitchClass(root);
    if (pitchClass === null) errors.push(`unknown root: ${root}`);
    else if (pitchClasses.has(pitchClass)) errors.push(`roots repeat a pitch class: ${root}`);
    else pitchClasses.add(pitchClass);
  }
  const seen = new Set();
  for (const quality of qualities || []) {
    if (!table[quality]) errors.push(`unknown quality: ${quality}`);
    else if (seen.has(quality)) errors.push(`qualities repeat: ${quality}`);
    else seen.add(quality);
  }

  // Gesture safety. Hints are asked for with runs of adjacent semitones, which
  // works only while no square can contain such a run. That is a property of
  // the vocabulary, not a law — so a scheme that breaks it is rejected here
  // rather than silently disabling help.
  for (const quality of qualities || []) {
    const intervals = table[quality]?.intervals;
    if (!Array.isArray(intervals)) continue;
    const classes = intervals.map((i) => ((i % 12) + 12) % 12);
    for (const size of [3, 4]) {
      for (let start = 0; start < 12; start += 1) {
        const run = Array.from({ length: size }, (_, i) => (start + i) % 12);
        if (run.every((pc) => classes.includes(pc))) {
          errors.push(`quality ${quality} contains a ${size}-semitone run, which collides with the hint gesture`);
        }
      }
    }
  }

  // Label ambiguity. Two ranks that read the same to a musician are worse than
  // two ranks that ARE the same: the board looks legible and lies.
  const labels = new Map();
  for (const quality of qualities || []) {
    const label = (table[quality]?.label || 'maj').toLowerCase();
    if (labels.has(label)) errors.push(`qualities ${labels.get(label)} and ${quality} share the label "${label}"`);
    else labels.set(label, quality);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Deals a fresh mapping of the same chords onto the board.
 *
 * Reshuffling each turn is what stops the board from being memorised. With a
 * fixed scheme a player learns "e2 is the square my king's pawn is on" and stops
 * reading chords entirely; reshuffled, the only way to find a piece is to read
 * the rim and work out what to play. The chord vocabulary never changes — only
 * where each chord sits — so the drill stays inside what the player knows.
 *
 * A permutation cannot introduce ambiguity, because collisions depend on which
 * roots and qualities are in play, not on their order. A scheme that is
 * collision-free stays collision-free however it is dealt.
 */
export function shuffleChordScheme(scheme = DEFAULT_CHORD_SCHEME, seed = 0) {
  const base = Number(seed) >>> 0;
  return {
    id: `${scheme.id}:shuffled:${base}`,
    // Two independent draws so the axes do not move together across turns.
    roots: shuffle(scheme.roots, base).items,
    qualities: shuffle(scheme.qualities, (base + 0x9E3779B9) >>> 0).items,
  };
}

/** Square -> the chord that addresses it. */
export function squareToChord(square, scheme = DEFAULT_CHORD_SCHEME) {
  if (isStaffScheme(scheme)) return squareToStaffAddress(square, scheme);
  if (!isSquare(square)) return null;
  const root = scheme.roots[FILES.indexOf(square[0])];
  const quality = scheme.qualities[RANKS.indexOf(square[1])];
  if (!root || !quality) return null;
  const base = {
    square,
    root,
    quality,
    name: CHORD_QUALITIES[quality]?.name ?? null,
    symbol: chordSymbol(root, quality),
    pitch_classes: chordPitchClasses(root, quality),
  };
  // The inversion policy rides on the scheme (see the addressing dimensions), so
  // a square knows which bass it wants and the rim can print it.
  const policy = scheme?.inversions ?? 'any';
  if (policy === 'any') return base;
  const bass = requiredBass(square, base, policy);
  return {
    ...base,
    required_bass: bass,
    symbol: slashSymbol(base.symbol, bass, rootPitchClass(root)),
  };
}

/** Chord -> the square it addresses, or null when the chord is off-scheme. */
export function chordToSquare(root, quality, scheme = DEFAULT_CHORD_SCHEME) {
  if (isStaffScheme(scheme)) return staffToSquare(root, quality, scheme);
  const file = scheme.roots.findIndex((candidate) => rootPitchClass(candidate) === rootPitchClass(root));
  const rank = scheme.qualities.indexOf(quality);
  if (file < 0 || rank < 0) return null;
  return `${FILES[file]}${RANKS[rank]}`;
}

/** Every square's chord — the lookup a kiosk overlay paints onto the board. */
export function chordBoard(scheme = DEFAULT_CHORD_SCHEME) {
  const board = {};
  for (const file of FILES) {
    for (const rank of RANKS) {
      const square = `${file}${rank}`;
      board[square] = squareToChord(square, scheme);
    }
  }
  return board;
}

/**
 * Squares whose chords are indistinguishable by pitch class alone.
 *
 * Augmented triads are the reason this exists: they are symmetric, so C-aug and
 * E-aug are the same three notes. Those squares can still be told apart, but only
 * by which note is in the bass — so a scheme that uses them must either keep the
 * root lowest or accept the ambiguity. Surfaced rather than hidden, because it
 * changes how the game must be played, not just how it is scored.
 */
export function findChordCollisions(scheme = DEFAULT_CHORD_SCHEME) {
  // A staff scheme addresses every square with a distinct PAIR of notes drawn
  // from two disjoint sets, so ambiguity is structurally impossible rather than
  // something to search for.
  if (isStaffScheme(scheme)) return [];
  const bySignature = new Map();
  for (const [square, chord] of Object.entries(chordBoard(scheme))) {
    if (!chord?.pitch_classes) continue;
    const signature = chord.pitch_classes.join(',');
    if (!bySignature.has(signature)) bySignature.set(signature, []);
    bySignature.get(signature).push({ square, symbol: chord.symbol });
  }
  return [...bySignature.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([signature, members]) => ({ pitch_classes: signature.split(',').map(Number), members }))
    .sort((a, b) => a.members[0].square.localeCompare(b.members[0].square));
}

/**
 * Which square did those keys mean?
 *
 * Matches on the pitch-class set, so voicing, octave, and doublings are free and
 * inversions cost nothing. When a set is ambiguous the lowest note decides, which
 * is also the musically correct habit to be teaching.
 */
export function identifyChord(midiNotes, scheme = DEFAULT_CHORD_SCHEME) {
  if (isStaffScheme(scheme)) return identifyStaffAddress(midiNotes, scheme);
  const notes = (Array.isArray(midiNotes) ? midiNotes : []).filter(Number.isFinite);
  if (!notes.length) return { square: null, candidates: [], pitch_classes: [] };
  const played = [...new Set(notes.map((note) => ((note % 12) + 12) % 12))].sort((a, b) => a - b);
  const bass = ((Math.min(...notes) % 12) + 12) % 12;
  const signature = played.join(',');

  const policy = scheme?.inversions ?? 'any';
  const candidates = [];
  for (const [square, chord] of Object.entries(chordBoard(scheme))) {
    if (chord?.pitch_classes?.join(',') !== signature) continue;
    // Under a policy the bass is LOAD-BEARING rather than a tiebreak: a square
    // whose required bass is not the note being played is not this address, so
    // it is not a candidate at all. That also means a policy can only ever make
    // an ambiguous set LESS ambiguous, never more.
    const wanted = policy === 'any' ? null : requiredBass(square, chord, policy);
    if (wanted !== null && wanted !== bass) continue;
    candidates.push({ square, symbol: chord.symbol, root_in_bass: rootPitchClass(chord.root) === bass });
  }
  candidates.sort((a, b) => Number(b.root_in_bass) - Number(a.root_in_bass) || a.square.localeCompare(b.square));
  return { square: candidates[0]?.square ?? null, candidates, pitch_classes: played };
}

/** A move as the two chords that perform it. */
export function moveToChordPair(from, to, scheme = DEFAULT_CHORD_SCHEME) {
  const origin = squareToChord(from, scheme);
  const destination = squareToChord(to, scheme);
  if (!origin || !destination) return null;
  return { from: origin, to: destination, notation: `${origin.symbol} -> ${destination.symbol}` };
}
