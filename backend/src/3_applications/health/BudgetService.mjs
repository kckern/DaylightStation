//
// The one home of the daily calorie equation:
//   remaining = budget - food + exercise
// The UI and the coach both read this — budget math is never computed
// client-side (spec, Data model §1).
import { computeDailyBudget } from '#domains/health/services/BudgetMath.mjs';

const STALE_WEIGHT_DAYS = 7;
const COUNTED = (item) => item?.status !== 'pending' && item?.status !== 'rejected' && item?.status !== 'deleted';

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
    const rawFood = items.filter(COUNTED).reduce((sum, i) => {
      const c = Number(i?.calories);
      return sum + (Number.isFinite(c) ? c : 0);
    }, 0);
    const food = Math.round(rawFood);

    const workouts = await this.#healthStore.getWorkoutsForDate(userId, date);
    const sessions = flattenWorkoutSessions(workouts);
    const exercise = Math.round(sumExerciseCalories(sessions));

    const remaining = budget - food + exercise;
    return {
      date, budget, food, exercise, net: food - exercise,
      remaining, status: remaining >= 0 ? 'under' : 'over', stale, sessions, goals,
    };
  }
}
export default BudgetService;
