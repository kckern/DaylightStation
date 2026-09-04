/**
 * catalogDensity — the catalog's canonical nutrition, DERIVED from observations.
 *
 * ## Why this exists
 *
 * The food catalog used to store the nutrition of the LAST row logged under a
 * name ("latest wins"), while every reader — quick-add, the suggest list, the
 * presenter — presented that number as "one serving". Log two bottles of a
 * shake once and the catalog remembered a 610 kcal "serving" of a 160 kcal
 * drink, forever, for every later one-tap add.
 *
 * The stable invariant across a food's own history is NOT its calorie total —
 * that is a portion multiple, and it moves. It is **kcal per gram**. Measured
 * over this household's 4,650 logged rows, the median within-name coefficient
 * of variation is 0.36 for calories and 0.07 for density.
 *
 * So the catalog stores OBSERVATIONS (what was actually logged, with its mass)
 * and derives the canonical value: take the observation nearest the median
 * density, scaled to the median mass. A single two-bottle row moves neither
 * median, and the derived serving stays a serving.
 *
 * Pure: no clock, no IO, no logging. Everything here is a function of its
 * arguments, which is what makes the drift audit and the reconcile
 * reproducible.
 */

/** How many observations an entry keeps. Older ones fall off the ring. */
export const OBSERVATION_LIMIT = 20;

/**
 * How far off its own history a row must sit before anything flags it.
 *
 * 2.2 is chosen from the data, not from taste: on the real history a density
 * check at this threshold flags 37 of 2,608 rows (1.4%) across 174 names —
 * loud enough to catch a doubled portion, quiet enough that a normal
 * half-again helping never trips it.
 */
export const DRIFT_RATIO = 2.2;

/**
 * The smallest mass we will compute a density from. Below this the quotient is
 * dominated by rounding (grams are stored to the nearest 5g) and a 1g "1
 * serving" fallback mass would read as a 610 kcal/g food.
 */
export const MIN_MASS_G = 5;

/** Units whose `grams` field is a real mass rather than a count of things. */
const MASS_UNITS = new Set(['g', 'gram', 'grams', 'ml', 'milliliter', 'millilitre']);

/**
 * A UPC scan read the manufacturer's own panel; a text parse guessed. Both are
 * observations and both count — gating WRITES on source would freeze 84% of
 * this catalog at whichever row happened to land first — but when the two
 * disagree about density, the label wins.
 */
const SOURCE_WEIGHTS = { upc: 3 };
const weightOf = (obs) => SOURCE_WEIGHTS[obs?.source] ?? 1;

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const round = (value, dp = 0) => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

/**
 * The usable mass of a logged row, or null.
 *
 * `YamlNutriListDatastore#normalizeItem` fills `grams` from `amount` when the
 * row has no mass of its own, so a "1 serving" row arrives claiming 1 gram.
 * Reading that as a mass turns a 610 kcal row into a 610 kcal/g food, which is
 * the single worst thing this module could do. So a mass is usable only when
 * it is big enough to divide by AND it is not the count wearing the mass's
 * clothes.
 */
export function usableGrams(row) {
  const grams = finite(Number(row?.grams));
  if (grams === null || grams < MIN_MASS_G) return null;
  const unit = typeof row?.unit === 'string' ? row.unit.toLowerCase().trim() : '';
  const amount = finite(Number(row?.amount));
  if (amount !== null && amount === grams && unit && !MASS_UNITS.has(unit)) return null;
  return grams;
}

/**
 * Build an observation from a logged row (a nutrilist row, or a freshly parsed
 * capture item). Returns null when the row cannot contribute — no name, no
 * calories, or no usable mass. A row with no mass is NOT an observation: it
 * carries a total with nothing to divide by, and the whole point of the ring
 * is that its members are comparable.
 */
export function observationFromRow(row, { source = null } = {}) {
  if (!row) return null;
  const kcal = finite(Number(row.calories));
  if (kcal === null || kcal <= 0) return null;
  const grams = usableGrams(row);
  if (grams === null) return null;
  const date = typeof row.date === 'string' && row.date
    ? row.date.slice(0, 10)
    : (typeof row.createdAt === 'string' ? row.createdAt.slice(0, 10) : null);
  const obs = {
    date: date || null,
    kcal,
    grams,
    logId: row.uuid || row.logId || row.id || null,
    source: source || row.source || null,
  };
  // Macros are copied ONLY when the row actually carries them. An absent macro
  // stays absent so the derived view falls through to whatever the entry
  // already held — a written 0 would be a claim nobody made.
  for (const key of ['protein', 'carbs', 'fat']) {
    const value = finite(Number(row[key]));
    if (value !== null) obs[key] = value;
  }
  return obs;
}

/**
 * Deterministic ordering for an observation ring: oldest first, ties broken by
 * id so two runs over the same history produce byte-identical output.
 */
export function sortObservations(observations) {
  return [...observations].sort((a, b) => {
    const byDate = String(a?.date ?? '').localeCompare(String(b?.date ?? ''));
    if (byDate !== 0) return byDate;
    return String(a?.logId ?? '').localeCompare(String(b?.logId ?? ''));
  });
}

/**
 * The canonical form of an observation ring: at most one observation per
 * `logId`, in a total order, trimmed to the newest OBSERVATION_LIMIT.
 *
 * ONE function, used by both the entity's `setObservations` and the reconcile's
 * change check, because they have to agree. When they did not, an entry whose
 * history carried two rows under one id was re-written on every reconcile run
 * — the file content was identical, so the hash still matched, but the job
 * reported `seeded: 1` forever and no longer proved anything.
 */
export function normalizeRing(observations) {
  const byId = new Map();
  const anonymous = [];
  for (const obs of Array.isArray(observations) ? observations : []) {
    if (!obs || typeof obs !== 'object') continue;
    if (obs.logId) byId.set(obs.logId, { ...obs }); else anonymous.push({ ...obs });
  }
  return sortObservations([...byId.values(), ...anonymous]).slice(-OBSERVATION_LIMIT);
}

/** Weighted median. `values` and `weights` are index-aligned and non-empty. */
export function weightedMedian(values, weights) {
  const pairs = values
    .map((value, i) => ({ value, weight: weights[i] > 0 ? weights[i] : 0 }))
    .filter((p) => Number.isFinite(p.value) && p.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (pairs.length === 0) return null;
  const total = pairs.reduce((sum, p) => sum + p.weight, 0);
  let seen = 0;
  for (const pair of pairs) {
    seen += pair.weight;
    if (seen * 2 >= total) return pair.value;
  }
  return pairs[pairs.length - 1].value;
}

/**
 * The canonical nutrition an entry's observations imply, or null when they
 * imply nothing.
 *
 * Null is the honest answer for an entry with no observation that carries a
 * mass, and callers must fall back to whatever the entry already holds rather
 * than writing a zero (the absence rule, decision 2.6).
 *
 * @param {Array} observations
 * @returns {{nutrients: Object, grams: number, density: number, sampleCount: number}|null}
 */
export function deriveCanonical(observations) {
  const usable = (Array.isArray(observations) ? observations : []).filter(
    (o) => finite(o?.kcal) !== null && o.kcal > 0 && finite(o?.grams) !== null && o.grams >= MIN_MASS_G,
  );
  if (usable.length === 0) return null;

  const weights = usable.map(weightOf);
  const density = weightedMedian(usable.map((o) => o.kcal / o.grams), weights);
  const grams = weightedMedian(usable.map((o) => o.grams), weights);
  if (density === null || grams === null || grams <= 0) return null;

  // The observation nearest the median DENSITY is the one whose macro split we
  // trust; the median MASS is the portion we scale it to. Ties resolve by the
  // later date and then by id, so this is a function of the ring and nothing
  // else.
  const ordered = sortObservations(usable);
  let pick = null;
  let bestDelta = Infinity;
  for (const obs of ordered) {
    const delta = Math.abs(obs.kcal / obs.grams - density);
    if (delta <= bestDelta) { bestDelta = delta; pick = obs; }
  }

  const factor = grams / pick.grams;
  const nutrients = { calories: round(pick.kcal * factor) };
  for (const key of ['protein', 'carbs', 'fat']) {
    const value = finite(pick[key]);
    if (value !== null) nutrients[key] = round(value * factor, 1);
  }
  return { nutrients, grams: round(grams, 1), density, sampleCount: usable.length };
}

/** The median kcal/g of a set of observations, or null. */
export function medianDensity(observations) {
  const derived = deriveCanonical(observations);
  return derived ? derived.density : null;
}

/**
 * How far apart two positive quantities are, as a ratio >= 1. Null when either
 * side is unknown — "I could not tell" is never "they agree".
 */
export function ratioApart(a, b) {
  const left = finite(a);
  const right = finite(b);
  if (left === null || right === null || left <= 0 || right <= 0) return null;
  return left > right ? left / right : right / left;
}

export default {
  OBSERVATION_LIMIT,
  normalizeRing,
  DRIFT_RATIO,
  MIN_MASS_G,
  usableGrams,
  observationFromRow,
  sortObservations,
  weightedMedian,
  deriveCanonical,
  medianDensity,
  ratioApart,
};
