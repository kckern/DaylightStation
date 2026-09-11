import { shuffle } from '@shared-gaming/mechanics/random.mjs';
import { materialFor } from './resolveAddressing.js';
import { validateChordScheme } from '../../PianoChessGame/chordAddress.js';
import { validateStaffScheme } from '../../PianoChessGame/staffAddress.js';

/**
 * Turn a resolved addressing config into the scheme the games already consume.
 *
 * The scheme shape is unchanged and deliberately so: `{ id, kind?, roots,
 * qualities }`, where `roots` addresses the X axis and `qualities` the Y axis
 * whatever the values happen to mean. Chess, Checkers and Connect Four all read
 * that shape today, and the point of this module is to give them ONE builder
 * instead of three hard-coded constants — not to change what they consume.
 *
 * Validation is the existing validators', not a new one. `validateChordScheme`
 * already knows the four rules that make a chord vocabulary legal (distinctness,
 * pitch-class collisions, the semitone runs that would swallow the help
 * gestures, and label ambiguity), and re-deriving them here would be a second
 * opinion that could disagree with the first.
 */
export function buildScheme(resolved, { size = 8, seed = 0 } = {}) {
  const vocabulary = resolved?.vocabulary ?? 'staff';
  const clefs = resolved?.clefs ?? 'grand';
  const x = axisValues(vocabulary, 'x', resolved?.x, size, seed, clefs, resolved?.texture);
  const y = axisValues(vocabulary, 'y', resolved?.y, size, (seed + 0x9E3779B9) >>> 0, clefs, resolved?.texture);

  // Two independent draws, so the axes do not move together across turns —
  // shuffling both with one seed re-deals the board while keeping every
  // (file, rank) pair's RELATIONSHIP intact, which is most of what a player
  // memorises.
  const scheme = vocabulary === 'chords'
    ? { id: schemeId(resolved, seed), roots: x, qualities: y, inversions: resolved?.inversions ?? 'any' }
    : { id: schemeId(resolved, seed), kind: 'staff', roots: x, qualities: y };

  const validation = vocabulary === 'chords'
    ? validateChordScheme(scheme)
    : validateStaffScheme(scheme);

  return { scheme, valid: validation.valid, errors: validation.errors ?? [] };
}

/**
 * The scheme a game should actually use, with the escape hatch and the fallback.
 *
 * An explicit `scheme` in config always wins — that is what it is for. A scheme
 * that fails validation is REFUSED, never silently repaired: the existing
 * `createChessGameState` already checks a custom scheme before accepting one,
 * and a board built from a half-applied scheme has squares no key can address.
 */
export function schemeFor(resolved, { size = 8, seed = 0, fallback = null } = {}) {
  if (resolved?.scheme) {
    const explicit = resolved.scheme;
    const validation = explicit.kind === 'staff'
      ? validateStaffScheme(explicit)
      : validateChordScheme(explicit);
    if (validation.valid) return { scheme: explicit, valid: true, errors: [], source: 'explicit' };
    return {
      scheme: fallback ?? buildScheme(resolved, { size, seed }).scheme,
      valid: false,
      errors: validation.errors ?? [],
      source: 'rejected-explicit',
    };
  }
  return { ...buildScheme(resolved, { size, seed }), source: 'built' };
}

/** How many notes each texture puts on a card. */
const TEXTURE_DEGREES = Object.freeze({ single: 1, dyad: 2, triad: 3 });

/**
 * The shape a slot is read as, built from the axis's OWN pitch material.
 *
 * This used to stack fixed SEMITONE intervals — `[0, 7]` for a dyad, `[0, 4, 7]`
 * for a triad — and that quietly made two things impossible.
 *
 * A naturals axis could not stay natural: a perfect fifth below bass B2 is E♭2,
 * so "dyads, no sharps or flats yet" was not a rung anybody could be put on. And
 * a diatonic tier came out wrong in the other direction: `[0, 4, 7]` is a MAJOR
 * triad by construction, so an F-major axis sprouted F♯ and C♯ that are not in
 * the key the tier exists to teach.
 *
 * Built by scale DEGREE instead — walk the pool by index, taking every other
 * slot (root, third, fifth) — and every note of every shape is drawn from the
 * tier's own set by construction. A naturals tier yields naturals-only dyads and
 * triads; tier 3's single accidental stays the only accidental on the board. The
 * interval therefore varies with the degree, a fifth here and a diminished fifth
 * there, which is the thing being read rather than a defect in it.
 *
 * Indices off either end wrap by the octave, so the axis's lowest slot still has
 * a third and a fifth beneath it.
 *
 * @param {number} index slot on the axis
 * @param {number[]} pool the tier's pitch material for this axis, low to high
 * @param {'single'|'dyad'|'triad'} texture
 * @param {boolean} upper stack upward (treble) or downward (bass)
 */
export function diatonicStaffShape(index, pool, texture = 'single', upper = true) {
  const degrees = TEXTURE_DEGREES[texture] ?? 1;
  if (degrees === 1 || !pool.length) return pool[index];
  // A dyad is the root and its fifth — degrees 0 and 4 — not the root and its
  // third. The fifth is the interval a hand finds without looking.
  const steps = degrees === 3 ? [0, 2, 4] : [0, 4];
  const notes = steps.map((step) => {
    const target = upper ? index + step : index - step;
    const octaves = Math.floor(target / pool.length);
    const wrapped = ((target % pool.length) + pool.length) % pool.length;
    return pool[wrapped] + octaves * 12;
  });
  return notes.sort((a, b) => a - b);
}

function axisValues(vocabulary, axis, config, size, seed, clefs, texture = 'single') {
  const pool = materialFor(vocabulary, axis, config?.tier ?? 2, clefs);
  // Take from the LOW end so a wider pool stays anchored where the narrower one
  // was: raising a tier should add material a player has not met, not move the
  // material they have.
  const other = vocabulary === 'staff' ? materialFor(vocabulary, axis === 'x' ? 'y' : 'x', config?.tier ?? 2, clefs) : [];
  const upper = vocabulary !== 'staff' || Math.min(...pool) > Math.min(...other);
  const taken = pool.slice(0, size).map((value, index) => (
    vocabulary === 'staff' ? diatonicStaffShape(index, pool, texture, upper) : value
  ));
  if (config?.order === 'shuffled') return shuffle(taken, seed).items;
  // Reverse is the same scale read downward — every interval still where it was,
  // so it is a real step up from sequential without throwing away the structure
  // a shuffle destroys.
  if (config?.order === 'reverse') return [...taken].reverse();
  return taken;
}

const orderMark = (order) => (order === 'shuffled' ? 's' : order === 'reverse' ? 'r' : '');

function schemeId(resolved, seed) {
  const parts = [
    resolved?.vocabulary ?? 'staff',
    resolved?.vocabulary === 'chords' ? null : (resolved?.clefs ?? 'grand'),
    resolved?.vocabulary === 'staff' && resolved?.texture !== 'single' ? resolved?.texture : null,
    `x${resolved?.x?.tier ?? 2}${orderMark(resolved?.x?.order)}`,
    `y${resolved?.y?.tier ?? 2}${orderMark(resolved?.y?.order)}`,
    resolved?.vocabulary === 'chords' && resolved?.inversions && resolved.inversions !== 'any'
      ? `inv-${resolved.inversions}` : null,
  ].filter(Boolean);
  const shuffled = resolved?.x?.order === 'shuffled' || resolved?.y?.order === 'shuffled';
  // The seed is part of the identity only when something actually moved —
  // otherwise every turn would look like a re-deal to anything keyed on the id.
  return shuffled ? `${parts.join('-')}:${seed >>> 0}` : parts.join('-');
}

export default buildScheme;
