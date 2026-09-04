import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplateService } from './TemplateService.mjs';
import { sumCounted } from '#shared/contracts/nutrition/countedRows.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const NOW = new Date('2026-09-04T09:15:00-07:00').getTime();

const SMOOTHIE = {
  name: 'Morning smoothie',
  icon: 'smoothie',
  components: [
    { name: 'Chia seeds', role: 'core', calories: 60, protein: 2, carbs: 5, fat: 4, grams: 12, unit: 'g', amount: 12 },
    { name: 'Protein drink', role: 'core', calories: 160, protein: 30, carbs: 5, fat: 2 },
    { name: 'Greens powder', role: 'core', calories: 40, protein: 2, carbs: 6, fat: 0 },
    { name: 'Blueberries', role: 'variant', calories: 80, protein: 1, carbs: 20, fat: 0 },
    { name: 'Mango', role: 'variant', calories: 100, protein: 1, carbs: 25, fat: 0 },
  ],
};

let store, nutriList, svc, saved, dismissed;

const makeService = (nowMs = NOW) => new TemplateService({
  templateStore: store,
  nutriListStore: nutriList,
  clock: { now: () => nowMs },
  createId: (() => { let n = 0; return () => `id-${n++}`; })(),
  logger: silent,
});

beforeEach(() => {
  saved = new Map();
  dismissed = [];
  store = {
    list: async () => [...saved.values()],
    getById: async (id) => saved.get(id) || null,
    save: async (t) => { saved.set(t.id, t); },
    remove: async (id) => { saved.delete(id); },
    listDismissedKeys: async () => [...dismissed],
    addDismissedKey: async (k) => { if (!dismissed.includes(k)) dismissed.push(k); },
  };
  nutriList = { saveMany: vi.fn(async () => {}) };
  svc = makeService();
});

describe('TemplateService.create', () => {
  it('stores components with their roles and initializes usage', async () => {
    const t = await svc.create(SMOOTHIE, 'u');
    expect(t.id).toBe('id-0');
    expect(t.source).toBe('manual');
    expect(t.status).toBe('active');
    expect(t.useCount).toBe(0);
    expect(t.lastUsed).toBeNull();
    expect(t.components.map((c) => c.role)).toEqual(['core', 'core', 'core', 'variant', 'variant']);
  });

  it('defaults an unroled component to core — a template with no roles is an all-core template', async () => {
    const t = await svc.create({ name: 'Toast', components: [{ name: 'Toast', calories: 90 }] }, 'u');
    expect(t.components[0].role).toBe('core');
  });

  it('rejects a nameless or empty template', async () => {
    await expect(svc.create({ name: '', components: [{ name: 'x' }] }, 'u')).rejects.toThrow(/name/);
    await expect(svc.create({ name: 'x', components: [] }, 'u')).rejects.toThrow(/components/);
  });
});

describe('TemplateService.instantiate', () => {
  it('writes ONE group row plus the core children, and the group row carries ZERO nutrition', async () => {
    const t = await svc.create(SMOOTHIE, 'u');
    const out = await svc.instantiate(t.id, 'u', { date: '2026-09-04', mealTime: 'morning' });

    expect(nutriList.saveMany).toHaveBeenCalledTimes(1);
    const rows = nutriList.saveMany.mock.calls[0][0];
    const groups = rows.filter((r) => r.kind === 'group');
    expect(groups).toHaveLength(1);
    expect(groups[0].uuid).toBe(out.groupUuid);
    expect(groups[0].name).toBe('Morning smoothie');
    expect(groups[0].parentId).toBeNull();
    // The invariant that a stale rollup can never violate: a header carries
    // no numbers at all, so a bucket that sums every row counts each food once.
    for (const key of ['calories', 'protein', 'carbs', 'fat']) {
      expect(groups[0][key]).toBe(0);
    }
    expect(rows.filter((r) => r.kind === 'item').map((r) => r.name))
      .toEqual(['Chia seeds', 'Protein drink', 'Greens powder']);
    expect(rows.filter((r) => r.kind === 'item').every((r) => r.parentId === out.groupUuid)).toBe(true);
  });

  it('ROW CONSERVATION: the day fold counts every chosen component exactly once and the group adds nothing', async () => {
    const t = await svc.create(SMOOTHIE, 'u');
    await svc.instantiate(t.id, 'u', { date: '2026-09-04', mealTime: 'morning', variantNames: ['Mango'] });
    const rows = nutriList.saveMany.mock.calls[0][0];

    const chosen = SMOOTHIE.components.filter((c) => c.role === 'core' || c.name === 'Mango');
    // Every chosen component appears in exactly one row.
    for (const c of chosen) {
      expect(rows.filter((r) => r.name === c.name)).toHaveLength(1);
    }
    // No row exists that is not the group or a chosen component.
    expect(rows).toHaveLength(chosen.length + 1);
    // ...and the ONE shared fold over the whole set equals the component sum.
    for (const key of ['calories', 'protein', 'carbs', 'fat']) {
      expect(sumCounted(rows, key)).toBe(chosen.reduce((s, c) => s + (c[key] || 0), 0));
    }
  });

  it('includes only the variants named, and unknown variant names are ignored', async () => {
    const t = await svc.create(SMOOTHIE, 'u');
    await svc.instantiate(t.id, 'u', { date: '2026-09-04', mealTime: 'morning', variantNames: ['Blueberries', 'Durian'] });
    const names = nutriList.saveMany.mock.calls[0][0].filter((r) => r.kind === 'item').map((r) => r.name);
    expect(names).toEqual(['Chia seeds', 'Protein drink', 'Greens powder', 'Blueberries']);
  });

  it('a core component can never be dropped by omitting it from variantNames', async () => {
    const t = await svc.create(SMOOTHIE, 'u');
    await svc.instantiate(t.id, 'u', { date: '2026-09-04', mealTime: 'morning', variantNames: [] });
    const names = nutriList.saveMany.mock.calls[0][0].filter((r) => r.kind === 'item').map((r) => r.name);
    expect(names).toEqual(['Chia seeds', 'Protein drink', 'Greens powder']);
  });

  it('stamps settled TRUE verbatim on every row it writes', async () => {
    const t = await svc.create(SMOOTHIE, 'u');
    await svc.instantiate(t.id, 'u', { date: '2026-09-04', mealTime: 'morning' });
    const rows = nutriList.saveMany.mock.calls[0][0];
    expect(rows.every((r) => r.settled === true)).toBe(true);
    expect(rows.every((r) => r.settledBy === 'user')).toBe(true);
    expect(rows.every((r) => typeof r.settledAt === 'string' && r.settledAt.length > 0)).toBe(true);
  });

  it('defaults the date to the LOCAL day and the bucket to the clock', async () => {
    const evening = makeService(new Date('2026-09-04T20:30:00-07:00').getTime());
    const t = await evening.create(SMOOTHIE, 'u');
    await evening.instantiate(t.id, 'u', {});
    const rows = nutriList.saveMany.mock.calls.at(-1)[0];
    // The UTC date here is 2026-09-05; the household's local date is the 4th.
    expect(rows.every((r) => r.date === '2026-09-04')).toBe(true);
    expect(rows.every((r) => r.mealTime === 'evening')).toBe(true);
  });

  it('bumps useCount and lastUsed', async () => {
    const t = await svc.create(SMOOTHIE, 'u');
    await svc.instantiate(t.id, 'u', { date: '2026-09-04', mealTime: 'morning' });
    await svc.instantiate(t.id, 'u', { date: '2026-09-05', mealTime: 'morning' });
    const after = await store.getById(t.id);
    expect(after.useCount).toBe(2);
    expect(after.lastUsed).toBe('2026-09-05');
  });

  it('refuses to instantiate a proposal — nothing is logged from something nobody approved', async () => {
    await svc.saveProposals([{ key: 'k1', suggestedName: 'Maybe smoothie', components: SMOOTHIE.components }], 'u');
    const [proposal] = await svc.list('u', { includeProposed: true });
    await expect(svc.instantiate(proposal.id, 'u', {})).rejects.toMatchObject({ code: 'TEMPLATE_NOT_ACTIVE' });
    expect(nutriList.saveMany).not.toHaveBeenCalled();
  });

  it('refuses an unknown id', async () => {
    await expect(svc.instantiate('nope', 'u', {})).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
  });
});

describe('TemplateService proposals', () => {
  it('list hides proposals unless asked', async () => {
    await svc.create(SMOOTHIE, 'u');
    await svc.saveProposals([{ key: 'k1', suggestedName: 'Maybe', components: [{ name: 'Eggs', role: 'core', calories: 90 }] }], 'u');
    expect((await svc.list('u')).map((t) => t.name)).toEqual(['Morning smoothie']);
    const all = await svc.list('u', { includeProposed: true });
    expect(all).toHaveLength(2);
    expect(all.find((t) => t.status === 'proposed').name).toBe('Maybe');
  });

  it('saveProposals is idempotent — the same key twice creates one proposal', async () => {
    const p = [{ key: 'k1', suggestedName: 'Maybe', components: [{ name: 'Eggs', role: 'core', calories: 90 }] }];
    const first = await svc.saveProposals(p, 'u');
    const second = await svc.saveProposals(p, 'u');
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(await svc.list('u', { includeProposed: true })).toHaveLength(1);
  });

  it('approve names the template, activates it, and marks it curated', async () => {
    await svc.saveProposals([{ key: 'k1', suggestedName: 'Maybe', components: [{ name: 'Eggs', role: 'core', calories: 90 }] }], 'u');
    const [proposal] = await svc.list('u', { includeProposed: true });
    const approved = await svc.approve(proposal.id, 'u', { name: 'Egg breakfast' });
    expect(approved.name).toBe('Egg breakfast');
    expect(approved.status).toBe('active');
    expect(approved.source).toBe('curated');
    expect(approved.proposalKey).toBe('k1');
    expect((await svc.list('u')).map((t) => t.name)).toEqual(['Egg breakfast']);
  });

  it('approve keeps the suggested name when none is supplied', async () => {
    await svc.saveProposals([{ key: 'k1', suggestedName: 'Maybe', components: [{ name: 'Eggs', role: 'core', calories: 90 }] }], 'u');
    const [proposal] = await svc.list('u', { includeProposed: true });
    expect((await svc.approve(proposal.id, 'u', {})).name).toBe('Maybe');
  });

  it('dismiss removes the proposal and remembers the key FOREVER, so mining cannot re-propose it', async () => {
    await svc.saveProposals([{ key: 'k1', suggestedName: 'Maybe', components: [{ name: 'Eggs', role: 'core', calories: 90 }] }], 'u');
    const [proposal] = await svc.list('u', { includeProposed: true });
    await svc.dismiss(proposal.id, 'u');
    expect(await svc.list('u', { includeProposed: true })).toHaveLength(0);
    expect(await svc.listDismissedKeys('u')).toEqual(['k1']);
    // The proof that "forever" means forever: mining the same combo again is refused.
    const again = await svc.saveProposals([{ key: 'k1', suggestedName: 'Maybe', components: [{ name: 'Eggs', role: 'core', calories: 90 }] }], 'u');
    expect(again.created).toBe(0);
    expect(await svc.list('u', { includeProposed: true })).toHaveLength(0);
  });

  it('approving a proposal blocks that key from being proposed again', async () => {
    await svc.saveProposals([{ key: 'k1', suggestedName: 'Maybe', components: [{ name: 'Eggs', role: 'core', calories: 90 }] }], 'u');
    const [proposal] = await svc.list('u', { includeProposed: true });
    await svc.approve(proposal.id, 'u', { name: 'Egg breakfast' });
    const again = await svc.saveProposals([{ key: 'k1', suggestedName: 'Maybe', components: [{ name: 'Eggs', role: 'core', calories: 90 }] }], 'u');
    expect(again.created).toBe(0);
  });

  it('dismiss on an ACTIVE template deletes it without poisoning the miner', async () => {
    const t = await svc.create(SMOOTHIE, 'u');
    await svc.remove(t.id, 'u');
    expect(await svc.list('u')).toHaveLength(0);
    expect(await svc.listDismissedKeys('u')).toEqual([]);
  });
});

describe('TemplateService.mergeIntoSuggestions (PRD F6.4)', () => {
  const food = (id, name, favorite = false) => ({ id, name, favorite, nutrients: { calories: 100 } });

  it('orders favorites → templates → the rest, and stamps a type on EVERY entry', async () => {
    await svc.create(SMOOTHIE, 'u');
    const merged = await svc.mergeIntoSuggestions(
      [food('f1', 'Fav apple', true), food('f2', 'Oatmeal'), food('f3', 'Rice')],
      { userId: 'u', limit: 12 },
    );
    expect(merged.map((e) => e.name)).toEqual(['Fav apple', 'Morning smoothie', 'Oatmeal', 'Rice']);
    expect(merged.map((e) => e.type)).toEqual(['food', 'template', 'food', 'food']);
  });

  it('a template entry carries its core item count and core calories', async () => {
    await svc.create(SMOOTHIE, 'u');
    const [template] = (await svc.mergeIntoSuggestions([], { userId: 'u' })).filter((e) => e.type === 'template');
    expect(template.itemCount).toBe(3);
    expect(template.variantCount).toBe(2);
    // 60 + 160 + 40 — the CORE only; a variant is not logged unless chosen.
    expect(template.nutrients.calories).toBe(260);
  });

  it('a typed query filters templates by name', async () => {
    await svc.create(SMOOTHIE, 'u');
    await svc.create({ name: 'Taco night', components: [{ name: 'Tortilla', calories: 100 }] }, 'u');
    const smoothie = await svc.mergeIntoSuggestions([], { userId: 'u', query: 'smoo' });
    expect(smoothie.map((e) => e.name)).toEqual(['Morning smoothie']);
    expect(await svc.mergeIntoSuggestions([], { userId: 'u', query: 'zzz' })).toEqual([]);
  });

  it('the zero-keystroke list shows at most three templates; a typed query shows every match', async () => {
    for (const n of ['Meal a', 'Meal b', 'Meal c', 'Meal d', 'Meal e']) {
      await svc.create({ name: n, components: [{ name: 'X', calories: 10 }] }, 'u');
    }
    expect((await svc.mergeIntoSuggestions([], { userId: 'u' })).length).toBe(3);
    expect((await svc.mergeIntoSuggestions([], { userId: 'u', query: 'meal' })).length).toBe(5);
  });

  it('never offers a PROPOSAL as a suggestion — it has not been approved', async () => {
    await svc.saveProposals([{ key: 'k1', suggestedName: 'Morning chia', components: [{ name: 'Chia', calories: 60 }] }], 'u');
    expect(await svc.mergeIntoSuggestions([food('f1', 'Oatmeal')], { userId: 'u' }))
      .toEqual([{ id: 'f1', name: 'Oatmeal', favorite: false, nutrients: { calories: 100 }, type: 'food' }]);
  });

  it('with no templates at all, the food list passes through untouched but typed', async () => {
    const merged = await svc.mergeIntoSuggestions([food('f1', 'Oatmeal')], { userId: 'u' });
    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe('food');
  });

  it('respects the limit, keeping favourites and templates over the tail', async () => {
    await svc.create(SMOOTHIE, 'u');
    const merged = await svc.mergeIntoSuggestions(
      [food('f1', 'Fav', true), food('f2', 'A'), food('f3', 'B')],
      { userId: 'u', limit: 2 },
    );
    expect(merged.map((e) => e.name)).toEqual(['Fav', 'Morning smoothie']);
  });
});

describe('TemplateService — micros and their provenance travel with a template', () => {
  const PROVENANCED = {
    name: 'Canned soup', role: 'core', calories: 200, protein: 8, carbs: 24, fat: 6,
    fiber: 3, sodium: 890, microsSource: 'catalog',
  };

  it('a component built from a provenanced food keeps its micros AND its source', async () => {
    const t = await svc.create({ name: 'Soup lunch', components: [PROVENANCED] }, 'u');
    expect(t.components[0]).toMatchObject({ fiber: 3, sodium: 890, microsSource: 'catalog' });
    // Per KEY: sugar and cholesterol were never measured, so they are not
    // written as structural zeros claiming to be readings.
    expect(t.components[0].sugar).toBeUndefined();
    expect(t.components[0].cholesterol).toBeUndefined();
  });

  it('instantiated rows carry them too — a template is not a downgrade of the food it came from', async () => {
    const t = await svc.create({ name: 'Soup lunch', components: [PROVENANCED] }, 'u');
    await svc.instantiate(t.id, 'u', { date: '2026-09-04', mealTime: 'afternoon' });
    const child = nutriList.saveMany.mock.calls[0][0].find((r) => r.kind === 'item');
    expect(child).toMatchObject({ fiber: 3, sodium: 890, microsSource: 'catalog' });
    // The GROUP header stays clean: it carries no nutrition at all, and groups
    // are excluded from micro coverage on both sides (decision 2.10).
    const group = nutriList.saveMany.mock.calls[0][0].find((r) => r.kind === 'group');
    expect(group.microsSource ?? null).toBeNull();
  });

  it('an UNPROVENANCED component donates no micros — its zeros are structure, not measurement', async () => {
    const t = await svc.create({
      name: 'Toast', components: [{ name: 'Toast', calories: 90, fiber: 0, sodium: 0 }],
    }, 'u');
    expect(t.components[0].microsSource).toBeNull();
    expect(t.components[0].fiber).toBeUndefined();
    expect(t.components[0].sodium).toBeUndefined();
  });

  it('provenance WITHOUT numbers is not provenance', async () => {
    const t = await svc.create({
      name: 'Claim only', components: [{ name: 'Mystery', calories: 100, microsSource: 'catalog' }],
    }, 'u');
    expect(t.components[0].microsSource).toBeNull();
  });

  it('a measured ZERO is data and survives', async () => {
    const t = await svc.create({
      name: 'Water', components: [{ name: 'Water', calories: 0, sodium: 0, microsSource: 'ai' }],
    }, 'u');
    expect(t.components[0]).toMatchObject({ sodium: 0, microsSource: 'ai' });
  });
});

describe('TemplateService — a template must log something', () => {
  it('refuses an all-variant template with nothing toggled rather than writing a lone empty group', async () => {
    const t = await svc.create({
      name: 'Pick one', components: [
        { name: 'Mango', role: 'variant', calories: 100 },
        { name: 'Blueberries', role: 'variant', calories: 80 },
      ],
    }, 'u');
    await expect(svc.instantiate(t.id, 'u', { date: '2026-09-04', mealTime: 'morning', variantNames: [] }))
      .rejects.toMatchObject({ code: 'TEMPLATE_NO_COMPONENTS' });
    expect(nutriList.saveMany).not.toHaveBeenCalled();
  });

  it('...and logs normally once one is chosen', async () => {
    const t = await svc.create({
      name: 'Pick one', components: [{ name: 'Mango', role: 'variant', calories: 100 }],
    }, 'u');
    await svc.instantiate(t.id, 'u', { date: '2026-09-04', mealTime: 'morning', variantNames: ['Mango'] });
    expect(nutriList.saveMany.mock.calls[0][0]).toHaveLength(2);
  });
});
