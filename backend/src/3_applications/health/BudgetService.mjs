//
// The one home of the daily calorie equation:
//   remaining = budget - food + exercise
// The UI and the coach both read this — budget math is never computed
// client-side (spec, Data model §1).
import { computeDailyBudget } from '#domains/health/services/BudgetMath.mjs';
import { isISODate } from '#shared/contracts/health/isoDate.mjs';
import { isCountedRow } from '#shared/contracts/nutrition/countedRows.mjs';

const STALE_WEIGHT_DAYS = 7;

// A range request folds one findByDateRange result and one weight/goal load,
// so its cost is flat in the number of days — but the response is not, and an
// unbounded `from` would happily ask the nutrilist adapter to walk every
// archive month on disk. 62 days covers the longest thing any surface asks for
// (a 30-day block, a 14-day adherence strip) with room to spare.
const MAX_RANGE_DAYS = 62;
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
  if (!['male', 'female'].includes(goals.sex)) goalsInvalid('sex must be male or female');
  for (const key of ['heightIn', 'birthYear']) {
    if (typeof goals[key] !== 'number' || !Number.isFinite(goals[key]) || goals[key] <= 0) goalsInvalid(`${key} must be a positive number`);
  }
  if (!Number.isInteger(goals.birthYear) || goals.birthYear < 1900 || goals.birthYear > new Date().getFullYear()) goalsInvalid('birthYear must be a valid year');
  for (const key of ['targetWeightLbs', 'activityBaseline', 'budgetFloor']) {
    if (goals[key] !== undefined && (typeof goals[key] !== 'number' || !Number.isFinite(goals[key]) || goals[key] <= 0)) goalsInvalid(`${key} must be positive`);
  }
  if (goals.weeklyRateLbs !== undefined && (typeof goals.weeklyRateLbs !== 'number' || !Number.isFinite(goals.weeklyRateLbs))) goalsInvalid('weeklyRateLbs must be numeric');

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

const rangeInvalid = (message) => {
  const err = new Error(`RANGE_INVALID: ${message}`);
  err.code = 'RANGE_INVALID';
  throw err;
};

// Inclusive [from, to] as YYYY-MM-DD, walked at a noon-UTC anchor so no DST
// transition can drop or duplicate a day.
const eachDate = (from, to) => {
  const out = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
};

// The date a nutrilist row belongs to, spelled exactly as
// YamlNutriListDatastore.findByDateRange's own filter spells it — a row whose
// `date` is absent is dated by its createdAt, and one with neither is dropped.
const rowDate = (row) => row?.date || row?.createdAt?.substring(0, 10) || null;

export class BudgetService {
  #goalsStore; #healthStore; #nutriListStore; #clock; #logger;

  constructor({ goalsStore, healthStore, nutriListStore, clock, logger }) {
    if (!goalsStore || !healthStore || !nutriListStore || !clock?.now) {
      throw new Error('BudgetService requires goalsStore, healthStore, nutriListStore, clock');
    }
    // getBudgetRange reads the workout ledger once for the whole range rather
    // than re-reading both whole lifelog files per day. Checked HERE so a store
    // missing it fails at construction with a name, not at call time inside a
    // range request.
    if (typeof healthStore.getWorkoutsForRange !== 'function') {
      throw new Error('BudgetService requires healthStore.getWorkoutsForRange');
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

  // ---------------------------------------------------------------------
  // The two pieces getBudget and getBudgetRange BOTH go through. They exist so
  // there is exactly one weight resolution and exactly one COUNTED fold in this
  // file: a "range-specific" copy of either is how the strip's bars and the
  // day's kcal number come to disagree on one screen.
  // ---------------------------------------------------------------------

  // Latest known adjusted-average weight at or before `date` -> the day's
  // budget. Throws NO_WEIGHT_DATA when no usable reading exists; the range
  // caller catches that per day and emits a gap rather than failing the range.
  // `sortedWeightDates` is the ONE sort, hoisted so a 62-day range does not
  // re-sort the whole weight history 62 times.
  #budgetForDate({ goals, weightData, sortedWeightDates, date }) {
    // Latest entry dated at or before `date`, whatever it holds. Deliberately
    // NOT "latest entry that happens to carry a usable number": a malformed
    // most-recent reading must surface as NO_WEIGHT_DATA rather than silently
    // resolving to an older, wrong weight.
    let latestDate = null;
    for (const d of sortedWeightDates) {
      if (d > date) break;
      latestDate = d;
    }
    const weightLbs = latestDate ? Number(weightData[latestDate]?.lbs_adjusted_average) : NaN;
    if (!Number.isFinite(weightLbs)) {
      const err = new Error('NO_WEIGHT_DATA: no usable weight reading for budget');
      err.code = 'NO_WEIGHT_DATA';
      throw err;
    }
    const daysOld = (new Date(`${date}T12:00:00Z`) - new Date(`${latestDate}T12:00:00Z`)) / 86400000;

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
    return { budget, stale: daysOld > STALE_WEIGHT_DAYS };
  }

  // THE fold. One COUNTED filter, one pass, feeding kcal, macros, micros and
  // coverage — see the COUNTED note at the top of this file.
  #foldItems(items) {
    const counted = (Array.isArray(items) ? items : []).filter(COUNTED);
    const sumOf = (key) => Math.round(counted.reduce((sum, i) => {
      const v = Number(i?.[key]);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0));

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
    const microCoverage = Object.fromEntries(
      MICRO_KEYS.map((k) => [k, { covered: foodRows.filter(i => (Boolean(i.nutrientProvenance?.[k]) && typeof i[k] === 'number' && Number.isFinite(i[k]))
        || (i.nutrientProvenance == null && Boolean(i.microsSource) && typeof i[k] === 'number' && i[k] !== 0)).length, total: foodRows.length }]),
    );

    return { food: sumOf('calories'), macros, microCoverage, loggedEntries: foodRows.length, loggingStatus: foodRows.length ? 'logged' : 'unlogged', goalBasis: 'current' };
  }

  async #loadGoalsOrThrow(userId) {
    const goals = await this.#goalsStore.load(userId);
    if (!goals) {
      const err = new Error('GOALS_NOT_CONFIGURED: set goals before requesting a budget');
      err.code = 'GOALS_NOT_CONFIGURED';
      throw err;
    }
    return goals;
  }

  async getBudget(userId, date, { items: snapshotItems } = {}) {
    const goals = await this.#loadGoalsOrThrow(userId);
    const weightData = await this.#healthStore.loadWeightData(userId) || {};
    const { budget, stale } = this.#budgetForDate({
      goals, weightData, sortedWeightDates: Object.keys(weightData).sort(), date,
    });

    // findByDate, not a hand-rolled filter: the store owns which rows belong to
    // a day (hot file AND archives), and getBudgetRange goes through the same
    // store rule via findByDateRange. Two different day-resolution rules is how
    // the equation and the week strip came to disagree about the same date.
    const items = snapshotItems ?? await this.#nutriListStore.findByDate(userId, date) ?? [];
    const { food, macros, microCoverage, loggedEntries, loggingStatus, goalBasis } = this.#foldItems(items);

    const workouts = await this.#healthStore.getWorkoutsForDate(userId, date);
    const sessions = flattenWorkoutSessions(workouts);
    const exercise = Math.round(sumExerciseCalories(sessions));

    const remaining = budget - food + exercise;
    return {
      date, budget, food, exercise, net: food - exercise,
      remaining, status: remaining >= 0 ? 'under' : 'over', stale, sessions, goals,
      macros, microCoverage, loggedEntries, loggingStatus, goalBasis,
    };
  }

  /**
   * The same equation over an inclusive date range, in ONE pass over storage:
   * goals once, weight history once, the whole range's nutrilist rows in a
   * single findByDateRange, and the workout ledger once via getWorkoutsForRange
   * (the per-date call re-reads the entire strava + fitness files every time —
   * 62 days would be 124 whole-file loads on one request).
   *
   * A day the equation cannot be computed for is a GAP, not a failure: it comes
   * back as `{ date, error: 'NO_WEIGHT_DATA' }` and the rest of the range is
   * unaffected. Missing goals is different — it is a property of the account,
   * not of a day, so it throws and the whole range 409s.
   *
   * @returns {Promise<Array<{date: string} & ({error: string} | object)>>}
   */
  async getBudgetRange(userId, from, to) {
    if (!isISODate(from) || !isISODate(to)) rangeInvalid('from and to must be YYYY-MM-DD dates');
    if (from > to) rangeInvalid('from must be on or before to');
    const dates = eachDate(from, to);
    if (dates.length > MAX_RANGE_DAYS) {
      rangeInvalid(`range is ${dates.length} days; the maximum is ${MAX_RANGE_DAYS}`);
    }

    const goals = await this.#loadGoalsOrThrow(userId);
    const [weightData, allItems, workoutsByDate] = await Promise.all([
      this.#healthStore.loadWeightData(userId).then((w) => w || {}),
      this.#nutriListStore.findByDateRange(userId, from, to).then((i) => i || []),
      this.#healthStore.getWorkoutsForRange(userId, from, to).then((w) => w || {}),
    ]);
    const sortedWeightDates = Object.keys(weightData).sort();

    // Fold the one range read into per-day buckets rather than re-filtering the
    // whole list once per date (O(days x rows) for no reason).
    const itemsByDate = new Map();
    for (const row of allItems) {
      const d = rowDate(row);
      if (!d) continue;
      const bucket = itemsByDate.get(d);
      if (bucket) bucket.push(row); else itemsByDate.set(d, [row]);
    }

    return dates.map((date) => {
      let budget; let stale;
      try {
        ({ budget, stale } = this.#budgetForDate({ goals, weightData, sortedWeightDates, date }));
      } catch (err) {
        if (err.code === 'NO_WEIGHT_DATA') return { date, error: 'NO_WEIGHT_DATA' };
        throw err;
      }
      const { food, macros, loggedEntries, loggingStatus, goalBasis } = this.#foldItems(itemsByDate.get(date) || []);
      const exercise = Math.round(sumExerciseCalories(flattenWorkoutSessions(workoutsByDate[date])));
      const remaining = budget - food + exercise;
      return {
        date, budget, food, exercise, net: food - exercise,
        remaining, status: remaining >= 0 ? 'under' : 'over', stale, macros, loggedEntries, loggingStatus, goalBasis,
      };
    });
  }
}
export default BudgetService;
