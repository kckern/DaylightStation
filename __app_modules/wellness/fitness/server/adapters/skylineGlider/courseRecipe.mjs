// Builds a Skyline Glider act (skyline-glider-course/v1) from a short recipe, so a
// new level is a few lines of config instead of hand-placed segments.
//
//   schema: skyline-glider-recipe/v1
//   id: desert-bells          name: Desert Bells
//   zone: smw-desert          act: 1
//   style: bells              # bells | hills | targets | bombing | gates | mixed
//   difficulty: easy          # easy | medium | hard
//   duration_s: 240           seed: 3
//
// The course is laid out as a run of features (a bell run, a hill, a target
// group, a bunker field, a gate) weighted by the style. It is deterministic for a
// seed. Callers must still validate the result with the game's own course model
// (validateCourse), which checks reachability.

export const RECIPE_STYLES = Object.freeze({
  bells: { bells: 5, hill: 2 },
  hills: { hill: 5, bells: 2 },
  targets: { targets: 5, bells: 1, hill: 1 },
  bombing: { bunkers: 4, tower: 1, bells: 1 },
  gates: { gate: 4, bells: 2, hill: 1 },
  mixed: { bells: 2, hill: 2, targets: 2, bunkers: 1, gate: 1 },
});

const DIFFICULTY = Object.freeze({
  easy: { peak: 0.7, gap: 0.34, hitPoints: 1, assist: true },
  medium: { peak: 0.6, gap: 0.3, hitPoints: 2, assist: true },
  hard: { peak: 0.5, gap: 0.26, hitPoints: 3, assist: false },
});

const FEATURE_LENGTH = Object.freeze({ bells: [24, 40], hill: [30, 55], targets: [18, 26], bunkers: [16, 22], tower: [8, 10], gate: [8, 10] });
const GROUND = 0.94;          // lower-terrain baseline (altitude: 0 = top, 1 = bottom)
const BUNKER_GROUND = 0.92;   // flat ground under bombing targets, as in the bundled acts
const CHECKPOINT_EVERY_S = 60;

/** Small deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

function pick(random, weights) {
  const entries = Object.entries(weights);
  let roll = random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [name, weight] of entries) { roll -= weight; if (roll <= 0) return name; }
  return entries.at(-1)[0];
}

export function validateRecipe(recipe) {
  const errors = [];
  if (recipe?.schema !== 'skyline-glider-recipe/v1') errors.push('schema must be skyline-glider-recipe/v1');
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(String(recipe?.id || ''))) errors.push('id must be a lowercase slug');
  if (!RECIPE_STYLES[recipe?.style]) errors.push(`style must be one of ${Object.keys(RECIPE_STYLES).join(', ')}`);
  if (recipe?.difficulty !== undefined && !DIFFICULTY[recipe.difficulty]) errors.push(`difficulty must be one of ${Object.keys(DIFFICULTY).join(', ')}`);
  if (recipe?.duration_s !== undefined && !(Number.isFinite(recipe.duration_s) && recipe.duration_s >= 90 && recipe.duration_s <= 900)) errors.push('duration_s must be 90 to 900');
  return errors;
}

/** Motion and rules every generated act shares (the bundled acts' tuning). */
const BASE = Object.freeze({
  rpm: { min: 30, max: 130 },
  motion: { filter_s: 0.25, deadband_rpm: 2, response_s: 0.6, max_climb_rate: 0.3, max_descent_rate: 0.3, coast_s: 1, disconnect_grace_s: 0.75, slow_signal_grace_s: 5, inferred_slowdown_s: 0.5 },
});

export function buildCourseFromRecipe(recipe) {
  const errors = validateRecipe(recipe);
  if (errors.length) throw new Error(`invalid recipe ${recipe?.id}: ${errors.join('; ')}`);
  const random = rng(recipe.seed ?? 1);
  const level = DIFFICULTY[recipe.difficulty ?? 'easy'];
  const duration = recipe.duration_s ?? 240;
  const id = recipe.id;
  const segments = [{ id: `${id}-sky`, type: 'open', start_s: 0, end_s: duration }];
  const entities = [];
  const bells = [];
  const busy = [];   // [start, end) windows with terrain, so checkpoints avoid them
  let serial = 0;
  const next = (kind) => `${kind}-${String(++serial).padStart(2, '0')}`;

  let t = 8;
  const end = duration - 12;
  while (t < end - 10) {
    const feature = pick(random, RECIPE_STYLES[recipe.style]);
    const [minLen, maxLen] = FEATURE_LENGTH[feature];
    const length = Math.min(Math.round(minLen + random() * (maxLen - minLen)), end - t);
    if (length < minLen * 0.75) break;
    if (feature === 'bells') {
      const phase = random() * Math.PI * 2;
      for (let at = t + 2; at <= t + length - 2; at += 5 + Math.round(random() * 3)) {
        bells.push({ id: `${id}-${next('bell')}`, at_s: at, altitude: round(0.55 + 0.17 * Math.sin(phase + at / 9)) });
      }
    } else if (feature === 'hill') {
      const peakAt = round(t + length * (0.4 + random() * 0.2), 1);
      const peak = round(level.peak + (random() - 0.5) * 0.06);
      segments.push({ id: `${id}-${next('hill')}`, type: 'lower-terrain', start_s: t, end_s: t + length, top: GROUND,
        profile: [{ at_s: t, altitude: GROUND }, { at_s: peakAt, altitude: peak }, { at_s: t + length, altitude: GROUND }] });
      busy.push([t, t + length]);
      // A bell over the summit, clear of the slope.
      bells.push({ id: `${id}-${next('bell')}`, at_s: peakAt, altitude: round(Math.max(0.25, peak - 0.2)) });
    } else if (feature === 'targets') {
      const count = 2 + Math.round(random());
      for (let index = 0; index < count; index += 1) {
        entities.push({ id: `${id}-${next('target')}`, entity: 'target', at_s: t + 3 + index * 7, altitude: round(0.4 + random() * 0.22), ...(level.hitPoints > 1 ? { hit_points: level.hitPoints } : {}) });
      }
    } else if (feature === 'bunkers') {
      segments.push({ id: `${id}-${next('ground')}`, type: 'lower-terrain', start_s: t, end_s: t + length, top: BUNKER_GROUND });
      busy.push([t, t + length]);
      const count = 2 + Math.round(random());
      for (let index = 0; index < count; index += 1) entities.push({ id: `${id}-${next('bunker')}`, entity: 'bunker', at_s: t + 4 + index * 6, altitude: BUNKER_GROUND });
    } else if (feature === 'tower') {
      segments.push({ id: `${id}-${next('ground')}`, type: 'lower-terrain', start_s: t, end_s: t + length, top: BUNKER_GROUND });
      busy.push([t, t + length]);
      entities.push({ id: `${id}-${next('tower')}`, entity: 'tower', at_s: t + Math.round(length / 2), altitude: BUNKER_GROUND });
    } else if (feature === 'gate') {
      entities.push({ id: `${id}-${next('gate')}`, entity: 'gate', at_s: t + Math.round(length / 2), gap_altitude: round(0.55 + random() * 0.1), gap: level.gap });
    }
    t += length + 4 + Math.round(random() * 4);
  }

  if (bells.length) segments.push({ id: `${id}-bells`, type: 'collectible-path', start_s: Math.min(...bells.map((b) => b.at_s)), end_s: Math.max(...bells.map((b) => b.at_s)), collectibles: bells });
  for (let at = CHECKPOINT_EVERY_S; at < duration - 15; at += CHECKPOINT_EVERY_S) {
    let spot = at;
    while (busy.some(([a, b]) => spot >= a - 2 && spot <= b + 2) && spot < duration - 15) spot += 1;
    if (spot < duration - 15) segments.push({ id: `${id}-${next('checkpoint')}`, type: 'checkpoint', start_s: spot, restart_altitude: 0.5 });
  }
  segments.push({ id: `${id}-finish`, type: 'finish', start_s: duration });
  segments.sort((a, b) => a.start_s - b.start_s);

  const armed = entities.some((entity) => ['target', 'bunker', 'tower'].includes(entity.entity));
  const bombTargets = entities.filter((entity) => ['bunker', 'tower'].includes(entity.entity)).length;
  return {
    schema: 'skyline-glider-course/v1',
    id,
    version: 1,
    zone: recipe.zone ?? 'alpine',
    ...(Number.isInteger(recipe.act) ? { act: recipe.act } : {}),
    name: recipe.name ?? id,
    description: recipe.description ?? `A ${recipe.difficulty ?? 'easy'} ${recipe.style} course.`,
    duration_s: duration,
    ...structuredClone(BASE),
    rules: {
      lives: 3, invincibility_s: 1.25, restart_delay_s: 2, assist_terrain: level.assist,
      weapons: armed ? { enabled: true, bombs: bombTargets * 2 + 2, missiles: 0, blast_width_s: 2.4, blast_height: 0.16 } : { enabled: false },
    },
    generated_from: { recipe: id, style: recipe.style, difficulty: recipe.difficulty ?? 'easy', seed: recipe.seed ?? 1 },
    segments,
    ...(entities.length ? { entities } : {}),
  };
}
