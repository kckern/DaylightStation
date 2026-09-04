import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlMealTemplateDatastore } from '#adapters/persistence/yaml/YamlMealTemplateDatastore.mjs';
import { TemplateService } from './TemplateService.mjs';
import { BudgetService } from './BudgetService.mjs';
import { sumCounted } from '#shared/contracts/nutrition/countedRows.mjs';

// The field-whitelist trap, applied to templates. `saveMany` is a WHITELIST:
// a key it does not name is silently dropped on the way to disk, and every
// unit test above this line passes anyway because it inspects the object the
// service handed over rather than the YAML that landed. So this walks the
// whole path with the REAL stores against a temp directory:
//
//   template -> instantiate -> saveMany -> YAML text on disk
//             -> findByDate -> BudgetService.getBudget
//
// Delete `kind`, `parentId` or `settled` from saveMany's map and this fails.

const NOW = new Date('2026-09-04T09:15:00-07:00').getTime();
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const GOALS = { weeklyRateLbs: 1, activityBaseline: 1.35, budgetFloor: 1200, heightIn: 70, birthYear: 1986, sex: 'male' };

let dir, nutriListStore, templateStore, svc, ids;

const yamlPath = () => path.join(dir, 'lifelog', 'nutrition', 'nutrilist.yml');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-roundtrip-'));
  ids = 0;
  const dataService = {
    user: {
      resolveDir: (rel) => path.join(dir, rel),
      read: (rel) => {
        const file = path.join(dir, `${rel}.json`);
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
      },
      write: (rel, value) => {
        const file = path.join(dir, `${rel}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(value));
        return true;
      },
    },
  };
  nutriListStore = new YamlNutriListDatastore({ dataService, logger: silent });
  templateStore = new YamlMealTemplateDatastore({ dataService });
  svc = new TemplateService({
    templateStore,
    nutriListStore,
    clock: { now: () => NOW },
    createId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    logger: silent,
  });
});

const makeBudgetService = () => new BudgetService({
  goalsStore: { load: async () => GOALS, save: async () => {} },
  healthStore: {
    loadWeightData: async () => ({ '2026-09-03': { lbs_adjusted_average: 200 } }),
    getWorkoutsForDate: async () => [],
    getWorkoutsForRange: async () => ({}),
  },
  nutriListStore,
  clock: { now: () => NOW },
  logger: silent,
});

describe('a template survives the real persistence path', () => {
  it('writes a group and its children to YAML, and the day counts each food EXACTLY once', async () => {
    const t = await svc.create({
      name: 'Morning smoothie',
      components: [
        { name: 'Chia seeds', role: 'core', calories: 60, protein: 2, carbs: 5, fat: 4 },
        { name: 'Protein drink', role: 'core', calories: 160, protein: 30, carbs: 5, fat: 2 },
        { name: 'Blueberries', role: 'variant', calories: 80, protein: 1, carbs: 20, fat: 0 },
      ],
    }, 'u1');
    const { groupUuid } = await svc.instantiate(t.id, 'u1', {
      date: '2026-09-04', mealTime: 'morning', variantNames: ['Blueberries'],
    });

    // The YAML TEXT, not an in-memory handle.
    const text = fs.readFileSync(yamlPath(), 'utf8');
    expect(text).toContain('kind: group');
    expect(text).toContain(`parentId: ${groupUuid}`);
    expect(text).toContain('settled: true');

    const rows = await nutriListStore.findByDate('u1', '2026-09-04');
    expect(rows).toHaveLength(4);
    const group = rows.find((r) => r.kind === 'group');
    expect(group.uuid).toBe(groupUuid);
    expect(group.calories).toBe(0);
    expect(rows.filter((r) => r.parentId === groupUuid)).toHaveLength(3);
    expect(rows.every((r) => r.settled === true)).toBe(true);

    // The day's kcal is the CHILDREN's kcal: 60 + 160 + 80. If the group row
    // ever carried the meal's total, this would read 600.
    expect(sumCounted(rows, 'calories')).toBe(300);
    const budget = await makeBudgetService().getBudget('u1', '2026-09-04');
    expect(budget.food).toBe(300);
  });

  it('a row written WITHOUT settled reads back undefined — never false, never null', async () => {
    // Constructed omitting the key on purpose: a test that passes
    // `settled: false` cannot detect a `?? false` default, because
    // `false ?? x` is `false` (decision 2.6).
    await nutriListStore.saveMany([{
      uuid: 'legacy-row', userId: 'u1', item: 'Legacy toast', calories: 90,
      date: '2026-09-04', mealTime: 'morning',
    }]);
    const [row] = (await nutriListStore.findByDate('u1', '2026-09-04')).filter((r) => r.uuid === 'legacy-row');
    expect(row.settled).toBeUndefined();
    expect(row.settled).not.toBe(false);
    expect(row.settled).not.toBeNull();
  });

  it('the template store round-trips components, roles and the dismissal ledger', async () => {
    const t = await svc.create({
      name: 'Egg breakfast',
      components: [{ name: 'Eggs', role: 'core', calories: 140 }, { name: 'Hot sauce', role: 'variant', calories: 5 }],
    }, 'u1');
    const back = await templateStore.getById(t.id, 'u1');
    expect(back.components.map((c) => c.role)).toEqual(['core', 'variant']);
    expect(back.status).toBe('active');
    expect(back.source).toBe('manual');

    await svc.saveProposals([{ key: 'k9', suggestedName: 'Maybe', components: [{ name: 'Oats', calories: 150 }] }], 'u1');
    const proposal = (await svc.list('u1', { includeProposed: true })).find((x) => x.status === 'proposed');
    await svc.dismiss(proposal.id, 'u1');
    expect(await templateStore.listDismissedKeys('u1')).toEqual(['k9']);
    // Persisted, so a fresh store instance over the same directory still refuses it.
    const reopened = new YamlMealTemplateDatastore({ dataService: { user: {
      read: (rel) => JSON.parse(fs.readFileSync(path.join(dir, `${rel}.json`), 'utf8')),
      write: () => true,
    } } });
    expect(await reopened.listDismissedKeys('u1')).toEqual(['k9']);
  });
});

describe('micro provenance survives the template path (the whole point of Theme 4)', () => {
  it('a template built from a provenanced food instantiates rows that still report COVERED', async () => {
    const t = await svc.create({
      name: 'Soup lunch',
      components: [
        { name: 'Canned soup', role: 'core', calories: 200, protein: 8, carbs: 24, fat: 6,
          fiber: 3, sodium: 890, microsSource: 'catalog' },
        { name: 'Crackers', role: 'core', calories: 120, protein: 2, carbs: 20, fat: 4 },
      ],
    }, 'u1');
    await svc.instantiate(t.id, 'u1', { date: '2026-09-04', mealTime: 'afternoon' });

    // Straight off the YAML text: the micro keys and the provenance flag both
    // landed. A whitelist that dropped either would leave this file silent.
    const text = fs.readFileSync(yamlPath(), 'utf8');
    expect(text).toContain('microsSource: catalog');
    expect(text).toContain('sodium: 890');

    const rows = await nutriListStore.findByDate('u1', '2026-09-04');
    const soup = rows.find((r) => r.name === 'Canned soup');
    expect(soup.microsSource).toBe('catalog');
    expect(soup.sodium).toBe(890);
    expect(soup.fiber).toBe(3);
    // The unprovenanced sibling is honestly uncovered, not falsely claimed.
    expect(rows.find((r) => r.name === 'Crackers').microsSource).toBeNull();

    // And the day's coverage caption agrees: 1 of 2 FOODS, the group header
    // counted on neither side.
    const budget = await makeBudgetService().getBudget('u1', '2026-09-04');
    expect(budget.microCoverage.sodium).toEqual({ covered: 1, total: 2 });
  });
})
