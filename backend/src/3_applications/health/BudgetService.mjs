//
// The one home of the daily calorie equation:
//   remaining = budget - food + exercise
// The UI and the coach both read this — budget math is never computed
// client-side (spec, Data model §1).
import { computeDailyBudget } from '#domains/health/services/BudgetMath.mjs';
import { isCountedRow } from '#shared/contracts/nutrition/countedRows.mjs';

const STALE_WEIGHT_DAYS = 7;
// THE one predicate, shared verbatim with the Today view's per-meal subtotals
// and footer (shared/contracts/nutrition/countedRows.mjs). The kcal fold and
// the macro fold are the same fold, applied once to one filtered list; two
// subtly different folds are how the bars and the number end up disagreeing on
// one screen. Keeping the client on this same file is what stops the frontend
// growing a second one.
const COUNTED = isCountedRow;

const MACRO_KEYS = ['protein', 'carbs', 'fat'];
const MICRO_KEYS = ['fiber', 'sugar', 'sodium', 'cholesterol'];

// Goal-shape vocabulary. `macroGoals` targets are grams; a watch micro's
// `limit` is in that micro's own stored unit (g for fiber/sugar, mg for
// sodium/cholesterol).
const MACRO_GOAL_KEYS = ['proteinG', 'carbsG', 'fatG'];
const WATCH_DIRECTIONS = ['ceiling', 'floor'];

const goalsInvalid = (message) => {
  const err = new Error(`GOALS_INVALID: ${message}`);
  err.code = 'GOALS_INVALID';
  throw err;
};

// Storage is a raw pass-through (YamlHealthGoalsDatastore writes whatever it is
// given), so this is the ONLY gate between a client payload and the goals file.
// It validates shape and never rewrites it: an ABSENT `macroGoals`/`watchMicros`
// stays absent — every goals file written before this phase omits both keys, and
// backfilling them (`?? null`, `?? {}`) would invent configuration the person
// never set.
function assertGoalsShape(goals) {
  if (!goals || typeof goals !== 'object' || Array.isArray(goals)) {
    goalsInvalid('goals must be an object');
  }

  const macroGoals = goals.macroGoals;
  if (macroGoals !== undefined && macroGoals !== null) {
    if (typeof macroGoals !== 'object' || Array.isArray(macroGoals)) {
      goalsInvalid('macroGoals must be an object of { proteinG, carbsG, fatG }');
    }
    for (const key of Object.keys(macroGoals)) {
      if (!MACRO_GOAL_KEYS.includes(key)) {
        goalsInvalid(`macroGoals has unknown key "${key}" (expected ${MACRO_GOAL_KEYS.join(', ')})`);
      }
      const value = macroGoals[key];
      // null is a CLEARED target, not a zero target — a zero protein goal and
      // "no protein goal" render differently and must stay distinguishable.
      if (value === null || value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        goalsInvalid(`macroGoals.${key} must be a non-negative number or null`);
      }
    }
  }

  const watchMicros = goals.watchMicros;
  if (watchMicros !== undefined && watchMicros !== null) {
    if (!Array.isArray(watchMicros)) goalsInvalid('watchMicros must be an array');
    const seen = new Set();
    for (const watch of watchMicros) {
      if (!watch || typeof watch !== 'object' || Array.isArray(watch)) {
        goalsInvalid('each watchMicros entry must be an object of { key, limit, direction }');
      }
      if (!MICRO_KEYS.includes(watch.key)) {
        goalsInvalid(`watchMicros.key must be one of ${MICRO_KEYS.join(', ')}`);
      }
      if (seen.has(watch.key)) goalsInvalid(`watchMicros has duplicate key "${watch.key}"`);
      seen.add(watch.key);
      if (typeof watch.limit !== 'number' || !Number.isFinite(watch.limit) || watch.limit <= 0) {
        goalsInvalid(`watchMicros.${watch.key}.limit must be a positive number`);
      }
      if (!WATCH_DIRECTIONS.includes(watch.direction)) {
        goalsInvalid(`watchMicros.${watch.key}.direction must be one of ${WATCH_DIRECTIONS.join(', ')}`);
      }
    }
  }
}

// Tolerant list normalizer: a workout group arrives as an array of session
// objects (or any nesting thereof) — deep-flatten to a single list, filtering
// out anything that isn't a plain session object.
const flattenGroup = (group) => {
  const list = Array.isArray(group) ? group : [];
  return list.flat(Infinity).filter((w) => w && typeof w === 'object' && !Array.isArray(w));
};

// YamlHealthDatastore.getWorkoutsForDate returns { activity: [...], fitness: [...] } —
// TWO VIEWS OF THE SAME WORKOUTS (Strava/Garmin activities vs. the Garmin daily
// fitness summary), not two independent workout lists. Summing both double-counts
// every session (verified live: a single 517-kcal run appears as 517 in `activity`
// AND 518 in `fitness`, under different titles). `activity` is the richer source
// (stable `id`, `homeSessionId`, precise `calories`/`minutes`) and is present
// whenever any workout was logged for the date; `fitness` is a plainer rollup that
// exists even on watchless days, so it's the fallback for when `activity` is empty.
// Pick ONE source — never both.
const flattenWorkoutSessions = (workouts) => {
  if (!workouts || typeof workouts !== 'object' || Array.isArray(workouts)) {
    return flattenGroup(workouts);
  }
  const activity = flattenGroup(workouts.activity);
  if (activity.length > 0) return activity;
  return flattenGroup(workouts.fitness);
};

// Tolerant calorie summer: count numeric `calories` (fallback `total_calories`)
// off an already-flattened list of session objects.
const sumExerciseCalories = (sessions) => sessions.reduce((sum, w) => {
  const c = Number(w?.calories ?? w?.total_calories);
  return sum + (Number.isFinite(c) ? c : 0);
}, 0);

export class BudgetService {
  #goalsStore; #healthStore; #nutriListStore; #clock; #logger;

  constructor({ goalsStore, healthStore, nutriListStore, clock, logger }) {
    if (!goalsStore || !healthStore || !nutriListStore || !clock?.now) {
      throw new Error('BudgetService requires goalsStore, healthStore, nutriListStore, clock');
    }
    this.#goalsStore = goalsStore;
    this.#healthStore = healthStore;
    this.#nutriListStore = nutriListStore;
    this.#clock = clock;
    this.#logger = logger || console;
  }

  async getGoals(userId) {
    return this.#goalsStore.load(userId);
  }

  async setGoals(userId, goals) {
    assertGoalsShape(goals);
    await this.#goalsStore.save(goals, userId);
    this.#logger.info?.('health.budget.goals_saved', { userId });
    return goals;
  }

  async getBudget(userId, date) {
    const goals = await this.#goalsStore.load(userId);
    if (!goals) {
      const err = new Error('GOALS_NOT_CONFIGURED: set goals before requesting a budget');
      err.code = 'GOALS_NOT_CONFIGURED';
      throw err;
    }

    // Latest known adjusted-average weight at or before `date`
    const weightData = await this.#healthStore.loadWeightData(userId) || {};
    const dates = Object.keys(weightData).filter((d) => d <= date).sort();
    const latestDate = dates.at(-1) || null;
    const weightLbs = latestDate ? Number(weightData[latestDate]?.lbs_adjusted_average) : NaN;
    if (!Number.isFinite(weightLbs)) {
      const err = new Error('NO_WEIGHT_DATA: no usable weight reading for budget');
      err.code = 'NO_WEIGHT_DATA';
      throw err;
    }
    const daysOld = (new Date(`${date}T12:00:00Z`) - new Date(`${latestDate}T12:00:00Z`)) / 86400000;
    const stale = daysOld > STALE_WEIGHT_DAYS;

    const now = new Date(this.#clock.now());
    const ageYears = now.getUTCFullYear() - Number(goals.birthYear);

    const budget = computeDailyBudget({
      weightLbs,
      heightIn: Number(goals.heightIn),
      ageYears,
      sex: goals.sex,
      activityBaseline: Number(goals.activityBaseline ?? 1.35),
      weeklyRateLbs: Number(goals.weeklyRateLbs ?? 1),
      budgetFloor: Number(goals.budgetFloor ?? 1200),
    });

    const items = await this.#nutriListStore.findByDate(userId, date) || [];
    const counted = items.filter(COUNTED);
    const sumOf = (key) => Math.round(counted.reduce((sum, i) => {
      const v = Number(i?.[key]);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0));
    const food = sumOf('calories');

    // Group rows carry ZERO nutrition by design (groupParsedItems.mjs); their
    // children carry the real values as siblings in this same flat list. So an
    // unconditional sum counts each food exactly once — no group special-casing.
    const macros = Object.fromEntries([...MACRO_KEYS, ...MICRO_KEYS].map((k) => [k, sumOf(k)]));

    // Micro coverage keys off PROVENANCE, never off the values. Every row on
    // disk stores `sodium: 0` when nothing measured it (validateFoodItem
    // defaults each micro `?? 0`), so a zero is indistinguishable from a
    // measured zero — only `microsSource` can tell them apart, and the UI
    // needs that to avoid reading an all-zero sodium bar as reassurance.
    //
    // A group row is a dish header, not a food: it carries no nutrition and no
    // provenance, so counting it in the denominator would report missing data
    // that does not exist. It is excluded from BOTH sides.
    const foodRows = counted.filter((i) => i?.kind !== 'group');
    const covered = foodRows.filter((i) => Boolean(i?.microsSource)).length;
    const microCoverage = Object.fromEntries(
      MICRO_KEYS.map((k) => [k, { covered, total: foodRows.length }]),
    );

    const workouts = await this.#healthStore.getWorkoutsForDate(userId, date);
    const sessions = flattenWorkoutSessions(workouts);
    const exercise = Math.round(sumExerciseCalories(sessions));

    const remaining = budget - food + exercise;
    return {
      date, budget, food, exercise, net: food - exercise,
      remaining, status: remaining >= 0 ? 'under' : 'over', stale, sessions, goals,
      macros, microCoverage,
    };
  }
}
export default BudgetService;
