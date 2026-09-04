import { describe, it, expect, beforeEach } from 'vitest';
import { migrateSavedMealsToTemplates, normalizeName } from './migrateSavedMealsToTemplates.lib.mjs';
import { TemplateService } from '#apps/health/TemplateService.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const NOW_ISO = '2026-09-04T16:15:00.000Z';

const MEALS = [
  {
    id: 'm1', name: 'Protein breakfast', createdAt: '2026-05-01T12:00:00Z', useCount: 12, lastUsed: '2026-09-01',
    items: [
      { name: 'Eggs', calories: 140, protein: 12, carbs: 1, fat: 10, color: 'green' },
      { name: 'Toast', calories: 90, protein: 3, carbs: 17, fat: 1 },
    ],
  },
  { id: 'm2', name: 'Post-ride shake', items: [{ name: 'Whey', calories: 160, protein: 30 }] },
];

let meals, templates, store, mealsStore, ids;

const migrate = (opts = {}) => migrateSavedMealsToTemplates({
  mealsStore, templateStore: store, userId: 'u', createId: () => `t-${++ids}`, nowIso: NOW_ISO, ...opts,
});

const snapshot = () => JSON.stringify([...templates.values()]);

beforeEach(() => {
  ids = 0;
  meals = MEALS.map((m) => JSON.parse(JSON.stringify(m)));
  templates = new Map();
  mealsStore = { list: async () => meals };
  store = {
    list: async () => [...templates.values()],
    getById: async (id) => templates.get(id) || null,
    save: async (t) => { templates.set(t.id, t); },
    remove: async (id) => { templates.delete(id); },
    listDismissedKeys: async () => [],
    addDismissedKey: async () => {},
  };
});

describe('saved-meal → template migration (Task 10.2)', () => {
  it('converts every saved meal into an ALL-CORE template and keeps its history', async () => {
    const summary = await migrate();
    expect(summary).toMatchObject({ total: 2, created: 2, skipped: 0 });
    const [breakfast] = [...templates.values()];
    expect(breakfast.name).toBe('Protein breakfast');
    expect(breakfast.source).toBe('manual');
    expect(breakfast.status).toBe('active');
    expect(breakfast.components.map((c) => c.role)).toEqual(['core', 'core']);
    expect(breakfast.components[0]).toMatchObject({ name: 'Eggs', calories: 140, color: 'green' });
    expect(breakfast.useCount).toBe(12);
    expect(breakfast.lastUsed).toBe('2026-09-01');
    expect(breakfast.createdAt).toBe('2026-05-01T12:00:00Z');
    expect(breakfast.migratedFromMealId).toBe('m1');
  });

  it('IS IDEMPOTENT: a second run creates nothing and leaves the store byte-identical', async () => {
    const first = await migrate();
    const afterFirst = snapshot();
    const second = await migrate();
    const afterSecond = snapshot();

    expect(first.created).toBe(2);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(2);
    expect(afterSecond).toBe(afterFirst);
    expect(templates.size).toBe(2);
    // Not just "no new rows" — no COUNTER moved either. This is the exact
    // property `backfill` lacks (decision 2.29), so it is asserted, not assumed.
    expect([...templates.values()].map((t) => t.useCount)).toEqual([12, 0]);
  });

  it('a third and fourth run are equally no-ops', async () => {
    await migrate();
    const stable = snapshot();
    await migrate();
    await migrate();
    expect(snapshot()).toBe(stable);
  });

  it('skips a name a template already occupies, whatever its casing or spacing', async () => {
    templates.set('pre', {
      id: 'pre', name: '  protein   BREAKFAST ', components: [{ name: 'Something else', role: 'core' }],
      status: 'active', source: 'manual', useCount: 0, lastUsed: null, proposalKey: null,
    });
    const summary = await migrate();
    expect(summary.created).toBe(1);
    expect(summary.createdNames).toEqual(['Post-ride shake']);
    expect(summary.skippedNames).toEqual(['Protein breakfast']);
    // The pre-existing template was not overwritten.
    expect(templates.get('pre').components[0].name).toBe('Something else');
  });

  it('a PROPOSED template also occupies its name — a migration must not create a twin', async () => {
    templates.set('p', {
      id: 'p', name: 'Post-ride shake', components: [{ name: 'Whey', role: 'core' }],
      status: 'proposed', source: 'curated', proposalKey: 'k1', useCount: 0, lastUsed: null,
    });
    const summary = await migrate();
    expect(summary.createdNames).toEqual(['Protein breakfast']);
  });

  it('skips a meal with no usable items rather than writing an empty template', async () => {
    meals = [{ id: 'm3', name: 'Empty', items: [] }, { id: 'm4', name: 'Nameless items', items: [{ calories: 10 }] }];
    const summary = await migrate();
    expect(summary).toMatchObject({ created: 0, skipped: 2 });
    expect(templates.size).toBe(0);
  });

  it('--dry-run reports the same plan and writes nothing', async () => {
    const dry = await migrate({ dryRun: true });
    expect(dry).toMatchObject({ created: 2, dryRun: true });
    expect(templates.size).toBe(0);
    // ...and the real run afterwards still creates both.
    expect((await migrate()).created).toBe(2);
  });

  it('the migrated template is instantiable through the real service, as an all-core group', async () => {
    await migrate();
    const svc = new TemplateService({
      templateStore: store,
      nutriListStore: { saveMany: async () => {} },
      clock: { now: () => new Date('2026-09-04T09:00:00-07:00').getTime() },
      createId: (() => { let n = 0; return () => `row-${n++}`; })(),
      logger: silent,
    });
    const template = (await svc.list('u')).find((t) => t.name === 'Protein breakfast');
    const { items } = await svc.instantiate(template.id, 'u', { date: '2026-09-04', mealTime: 'morning' });
    expect(items.filter((r) => r.kind === 'group')).toHaveLength(1);
    expect(items.filter((r) => r.kind === 'item').map((r) => r.name)).toEqual(['Eggs', 'Toast']);
  });

  it('normalizeName folds case and inner whitespace', () => {
    expect(normalizeName('  Morning   Smoothie ')).toBe('morning smoothie');
    expect(normalizeName(null)).toBe('');
  });
});
