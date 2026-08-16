import { shuffle } from '@shared-gaming/rng.mjs';
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
  const x = axisValues(vocabulary, 'x', resolved?.x, size, seed, clefs);
  const y = axisValues(vocabulary, 'y', resolved?.y, size, (seed + 0x9E3779B9) >>> 0, clefs);

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

function axisValues(vocabulary, axis, config, size, seed, clefs) {
  const pool = materialFor(vocabulary, axis, config?.tier ?? 2, clefs);
  // Take from the LOW end so a wider pool stays anchored where the narrower one
  // was: raising a tier should add material a player has not met, not move the
  // material they have.
  const taken = pool.slice(0, size);
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
