import {
  ADDRESSING_DEFAULTS, CADENCES, CHORD_TIERS, CLEF_PAIRS, INVERSIONS, MAX_RUNG, MAX_TIER,
  MIN_RUNG, MIN_TIER, ORDERS, STAFF_TIERS, VOCABULARIES, rungAt,
} from './dimensions.js';

/**
 * Resolve the addressing config from its layers.
 *
 *   house default  →  the game's own default  →  the ladder rung  →  this player
 *
 * Each layer states only what it changes; every dimension is independently
 * overridable at every layer. That last clause is the whole requirement, and it
 * is why this is a per-key merge rather than a spread: a player who sets one
 * dimension must not lose the other seven to defaults.
 *
 * Unknown values are DROPPED with a reason rather than passed through. A typo in
 * a hand-edited YAML (`vocabulary: staves`) should degrade to the layer beneath
 * and say so, not reach the scheme builder and produce a board nobody can play.
 *
 * See docs/reference/piano/grid-addressing.md for what each dimension means.
 */
export function resolveAddressing({
  game = null,
  rung = null,
  user = null,
  ladder = null,
  axisSize = 8,
} = {}) {
  const notes = [];
  const layers = [
    ADDRESSING_DEFAULTS,
    normalizeAddressing(game, notes, 'game'),
    normalizeAddressing(rungConfig(ladder, rung, notes), notes, 'rung'),
    normalizeAddressing(user, notes, 'user'),
  ];

  let resolved = {};
  for (const layer of layers) resolved = mergeLayer(resolved, layer);

  // An axis needs at least as many notes as it has slots. Raising the tier is
  // the honest repair: dealing a short axis leaves squares that no key can
  // address, which looks identical to a broken game from the player's chair.
  for (const axis of ['x', 'y']) {
    const raised = raiseTierToFit(resolved.vocabulary, resolved[axis].tier, axisSize, resolved.clefs);
    if (raised !== resolved[axis].tier) {
      notes.push(`${axis}.tier ${resolved[axis].tier} has too few notes for ${axisSize} slots; raised to ${raised}`);
      resolved = { ...resolved, [axis]: { ...resolved[axis], tier: raised } };
    }
  }

  // A two-note staff address has no inversion to have an opinion about, so the
  // knob is reported as `any` there whatever was configured. Kept in the config
  // rather than deleted — same reason `clefs` survives a switch to `chords`: a
  // player toggling back should get their setting, not a default.
  const effectiveInversions = resolved.vocabulary === 'chords' ? resolved.inversions : 'any';
  if (effectiveInversions !== resolved.inversions) {
    notes.push(`inversions "${resolved.inversions}" has no meaning for the ${resolved.vocabulary} vocabulary`);
  }

  return { ...resolved, inversions: effectiveInversions, configured: resolved, notes };
}

/** Which rung applies: a pin beats the earned level, and both beat nothing. */
export function activeRung(ladder = null, explicit = null) {
  if (Number.isFinite(explicit)) return clamp(Math.floor(explicit), MIN_RUNG, MAX_RUNG);
  const pinned = ladder?.pinned;
  // A pin is the "hold this player still" case: keep it sequential, keep it
  // root notes, regardless of what they have earned. It wins over the ladder.
  if (Number.isFinite(pinned)) return clamp(Math.floor(pinned), MIN_RUNG, MAX_RUNG);
  const earned = ladder?.unlocked_through;
  if (Number.isFinite(earned)) return clamp(Math.floor(earned), MIN_RUNG, MAX_RUNG);
  return null;
}

function rungConfig(ladder, explicit, notes) {
  const number = activeRung(ladder, explicit);
  if (number === null) return null;
  const entry = rungAt(number);
  if (!entry) {
    notes.push(`no addressing rung ${number}`);
    return null;
  }
  return Object.fromEntries(
    Object.entries(entry).filter(([key]) => key !== 'rung' && key !== 'label'),
  );
}

/**
 * One layer, validated.
 *
 * The canonical shape is an object, optionally nested under `addressing`.
 */
export function normalizeAddressing(input, notes = [], layer = 'config') {
  if (input === null || input === undefined) return {};
  if (typeof input !== 'object') return {};

  const source = { ...input, ...(input.addressing && typeof input.addressing === 'object' ? input.addressing : {}) };

  const out = {};

  if (source.vocabulary !== undefined
    && enumValue('vocabulary', source.vocabulary, VOCABULARIES, notes, layer)) {
    out.vocabulary = source.vocabulary;
  }
  if (source.clefs !== undefined
    && enumValue('clefs', source.clefs, CLEF_PAIRS, notes, layer)) {
    out.clefs = source.clefs;
  }
  if (source.shuffle !== undefined
    && enumValue('shuffle', source.shuffle, CADENCES, notes, layer)) {
    out.shuffle = source.shuffle;
  }
  if (source.inversions !== undefined
    && enumValue('inversions', source.inversions, INVERSIONS, notes, layer)) {
    out.inversions = source.inversions;
  }
  for (const axis of ['x', 'y']) {
    const value = source[axis];
    if (!value || typeof value !== 'object') continue;
    const resolved = {};
    if (value.tier !== undefined) {
      const tier = Math.floor(Number(value.tier));
      if (Number.isFinite(tier) && tier >= MIN_TIER && tier <= MAX_TIER) resolved.tier = tier;
      else notes.push(`${layer}: ${axis}.tier ${value.tier} is not a tier ${MIN_TIER}-${MAX_TIER}`);
    }
    if (value.order !== undefined && enumValue(`${axis}.order`, value.order, ORDERS, notes, layer)) {
      resolved.order = value.order;
    }
    if (Object.keys(resolved).length) out[axis] = resolved;
  }

  // An explicit scheme is the escape hatch and always wins over the dimensions
  // that would otherwise build one. It is validated by the scheme builder, not
  // here — this layer only decides whether it was stated.
  if (source.scheme !== undefined) out.scheme = source.scheme;

  return out;
}

/**
 * Notes available to an axis at a tier, for a vocabulary and a clef pair.
 *
 * The two axes must occupy DISJOINT pitch ranges, because that separation is
 * what lets a played note say which axis it belongs to — the grand-staff
 * default splits at middle C, and every other pair needs its own boundary
 * derived the same way (see `splitFor` in staffAddress.js). Two axes sharing a
 * range would make a played C mean both a file and a rank, and the address
 * would be unresolvable.
 *
 * `treble-only` and `bass-only` therefore stack the two axes an octave-plus
 * apart WITHIN one clef's comfortable range, rather than putting them in the
 * same octave and hoping. `inverted` is the grand pair with the hands swapped:
 * the left hand picks the file, which is deliberately awkward and is the point.
 */
export function materialFor(vocabulary, axis, tier, clefs = 'grand') {
  if (vocabulary === 'chords') {
    const table = CHORD_TIERS[tier] ?? CHORD_TIERS[2];
    return axis === 'y' ? table.qualities : table.roots;
  }
  const table = STAFF_TIERS[tier] ?? STAFF_TIERS[2];
  const shift = (notes, semitones) => notes.map((note) => note + semitones);
  switch (clefs) {
    // Both axes notated in treble clef: C4-C5 for files, D5 up for ranks. The
    // gap is what keeps them separable.
    case 'treble-only':
      return axis === 'y' ? shift(table.treble, 14) : table.treble;
    // Both in bass clef, the same idea downward.
    case 'bass-only':
      return axis === 'y' ? shift(table.bass, -14) : table.bass;
    // Hands swapped: the left hand picks the file.
    case 'inverted':
      return axis === 'y' ? table.treble : table.bass;
    case 'grand':
    default:
      return axis === 'y' ? table.bass : table.treble;
  }
}

/** The lowest tier at or above `tier` whose pool fills `size` slots. */
export function raiseTierToFit(vocabulary, tier, size, clefs = 'grand') {
  for (let candidate = tier; candidate <= MAX_TIER; candidate += 1) {
    const x = materialFor(vocabulary, 'x', candidate, clefs);
    const y = materialFor(vocabulary, 'y', candidate, clefs);
    if (x.length >= size && y.length >= size) return candidate;
  }
  return MAX_TIER;
}

function mergeLayer(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) continue;
    out[key] = (key === 'x' || key === 'y') ? { ...(base[key] || {}), ...value } : value;
  }
  return out;
}

function enumValue(name, value, allowed, notes, layer) {
  if (allowed.includes(value)) return true;
  notes.push(`${layer}: ${name} "${value}" is not one of ${allowed.join(', ')}`);
  return false;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export default resolveAddressing;
