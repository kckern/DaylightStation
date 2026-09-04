import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { BudgetService } from './BudgetService.mjs';
import { HealthOperations } from './HealthOperations.mjs';

// C1 — a LIVE PRODUCTION bug this program did not introduce but did surface.
//
// `findByDate` read only the hot nutrilist file and matched `item.date`
// exactly. `findByDateRange` also loads monthly archives and dates a row by
// `date ?? createdAt`. Once a day passed the 30-day retention window and was
// archived, the two disagreed about that same day: the week strip (range) drew
// a real bar while the equation and the meal list (day) reported that the
// person had eaten nothing. On the running container, 2026-07-30 answered
// `food: 0` and `count: 0` while the archive held the rows.
//
// So the assertion here is not "getBudget works". It is: **a day on either
// side of the archive boundary behaves identically, through every read.** It
// uses the REAL datastore against a real temp directory, because the divergence
// lived INSIDE the store — any fake that implements both methods from one row
// set is structurally unable to reproduce it.

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const GOALS = { weeklyRateLbs: 1, activityBaseline: 1.35, budgetFloor: 1200, heightIn: 70, birthYear: 1986, sex: 'male' };

// "Today" for the test clock. Retention is 30 days, so:
const NOW_ISO = '2026-09-04';
const HOT_DAY = '2026-09-01';       // inside retention — lives in the hot file
const ARCHIVED_DAY = '2026-07-30';  // well past it — lives in an archive
const NOW = new Date(`${NOW_ISO}T12:00:00Z`).getTime();

const row = (over) => ({
  uuid: over.uuid, userId: 'u1', item: over.name, name: over.name, label: over.name,
  unit: 'g', amount: 100, grams: 100, calories: over.calories, protein: 10, carbs: 20, fat: 5,
  fiber: 0, sugar: 0, sodium: 0, cholesterol: 0, color: 'green', noom_color: 'green',
  status: over.status ?? 'accepted', mealTime: 'lunch',
  ...over,
});

let dir, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'day-archive-'));
  store = new YamlNutriListDatastore({
    dataService: { user: { resolveDir: (rel) => path.join(dir, rel) } },
    logger: silent,
  });
});

const writeYaml = (rel, data) => {
  const file = path.join(dir, `${rel}.yml`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump(data));
};

const seed = ({ hot = [], archive = [], archiveMonth = '2026-07' } = {}) => {
  writeYaml('lifelog/nutrition/nutrilist', hot);
  if (archive.length) writeYaml(`lifelog/nutrition/archives/nutrilist/${archiveMonth}`, archive);
};

const makeBudget = () => new BudgetService({
  goalsStore: { load: async () => GOALS, save: async () => {} },
  healthStore: {
    loadWeightData: async () => ({ '2026-07-01': { lbs_adjusted_average: 200 } }),
    getWorkoutsForDate: async () => ({ activity: [{ calories: 281 }], fitness: [] }),
    getWorkoutsForRange: async () => ({
      [HOT_DAY]: { activity: [{ calories: 281 }], fitness: [] },
      [ARCHIVED_DAY]: { activity: [{ calories: 281 }], fitness: [] },
    }),
  },
  nutriListStore: store,
  clock: { now: () => NOW },
  logger: silent,
});

const HOT_ROWS = [
  row({ uuid: 'h1', name: 'Oats', calories: 300, date: HOT_DAY }),
  row({ uuid: 'h2', name: 'Chicken', calories: 450, date: HOT_DAY }),
  row({ uuid: 'h3', name: 'Ghost', calories: 999, date: HOT_DAY, status: 'pending' }),
];
const ARCHIVED_ROWS = [
  row({ uuid: 'a1', name: 'Toast', calories: 248, date: ARCHIVED_DAY }),
  row({ uuid: 'a2', name: 'Curry', calories: 1492, date: ARCHIVED_DAY }),
  row({ uuid: 'a3', name: 'Ghost', calories: 999, date: ARCHIVED_DAY, status: 'deleted' }),
];

describe('a day either side of the archive boundary behaves identically', () => {
  beforeEach(() => seed({ hot: HOT_ROWS, archive: ARCHIVED_ROWS }));

  it('the store finds an ARCHIVED day through findByDate, not only through findByDateRange', async () => {
    const byDate = await store.findByDate('u1', ARCHIVED_DAY);
    const byRange = await store.findByDateRange('u1', ARCHIVED_DAY, ARCHIVED_DAY);
    expect(byDate).toHaveLength(3);
    expect(byDate.map((r) => r.uuid).sort()).toEqual(byRange.map((r) => r.uuid).sort());
  });

  it('the day equation and the range agree on the ARCHIVED day — the shipped bug', async () => {
    const svc = makeBudget();
    const single = await svc.getBudget('u1', ARCHIVED_DAY);
    const [ranged] = await svc.getBudgetRange('u1', ARCHIVED_DAY, ARCHIVED_DAY);
    // 248 + 1492; the `deleted` row never counts on either side.
    expect(single.food).toBe(1740);
    expect(ranged.food).toBe(single.food);
    expect(ranged.remaining).toBe(single.remaining);
    expect(ranged.macros).toEqual(single.macros);
  });

  it('and on the HOT day, so the fix did not simply move the disagreement', async () => {
    const svc = makeBudget();
    const single = await svc.getBudget('u1', HOT_DAY);
    const [ranged] = await svc.getBudgetRange('u1', HOT_DAY, HOT_DAY);
    expect(single.food).toBe(750);
    expect(ranged.food).toBe(single.food);
  });

  it('the ROWS that justify the total are visible too — a correct headline over an empty list is a worse lie', async () => {
    const ops = new HealthOperations({
      nutritionItems: store,
      today: () => NOW_ISO,
      newId: () => 'x',
      resolveDefaultUsername: () => 'u1',
    });
    const rows = await ops.findNutritionItemsByDate('u1', ARCHIVED_DAY);
    expect(rows.map((r) => r.name).sort()).toEqual(['Curry', 'Ghost', 'Toast']);
  });

  it('a row dated only by createdAt counts on its day in BOTH reads', async () => {
    // The second, independent divergence mechanism the reviewer probed: the
    // archiver files a row by `date ?? createdAt`, so a lookup must too.
    seed({ hot: [
      row({ uuid: 'c1', name: 'Undated', calories: 600, date: undefined, createdAt: `${HOT_DAY}T18:00:00Z` }),
      row({ uuid: 'c2', name: 'Dated', calories: 400, date: HOT_DAY }),
    ] });
    const svc = makeBudget();
    const single = await svc.getBudget('u1', HOT_DAY);
    const [ranged] = await svc.getBudgetRange('u1', HOT_DAY, HOT_DAY);
    expect(single.food).toBe(1000);
    expect(ranged.food).toBe(single.food);
  });

  it('a row that lingered in the hot file after being archived is counted ONCE', async () => {
    seed({ hot: [ARCHIVED_ROWS[0]], archive: ARCHIVED_ROWS });
    const svc = makeBudget();
    const single = await svc.getBudget('u1', ARCHIVED_DAY);
    expect(single.food).toBe(1740); // not 1988
  });

  it('preserves the day view\'s existing row ORDER — the fix must not reshuffle the log', async () => {
    const rows = await store.findByDate('u1', HOT_DAY);
    expect(rows.map((r) => r.name)).toEqual(['Oats', 'Chicken', 'Ghost']);
  });

  it('does not touch archives for a day inside the retention window', async () => {
    // Cost guard: the common case (today, this week) must stay exactly as cheap
    // as it was before findByDate learned about archives.
    let archiveReads = 0;
    const spyDir = path.join(dir, 'lifelog/nutrition/archives/nutrilist');
    const realReaddir = fs.readdirSync;
    try {
      fs.readdirSync = (p, ...rest) => {
        if (String(p).startsWith(spyDir)) archiveReads += 1;
        return realReaddir(p, ...rest);
      };
      await store.findByDate('u1', HOT_DAY);
    } finally {
      fs.readdirSync = realReaddir;
    }
    expect(archiveReads).toBe(0);
  });
});
