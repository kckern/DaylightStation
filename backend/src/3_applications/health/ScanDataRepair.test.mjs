import { describe, it, expect } from 'vitest';
import { planScanDataRepair, planCatalogIconRepair } from './ScanDataRepair.mjs';

// Fixtures mirror the 2026-09-22 data-quality audit
// (docs/_wip/audits/2026-09-22-health-app-data-quality-audit.md).
const NULL_NUTRIENTS = { calories: null, protein: null, carbs: null, fat: null, fiber: null, sugar: null, sodium: null, cholesterol: null };
const row = ({ id, item, startedAt = '2026-09-21T12:00:00.000Z', source = 'upc', ...over }) => ({
  id, uuid: id, item, version: 1, date: '2026-09-21', mealTime: 'evening',
  unit: 'g', amount: 100, grams: 100, originalQuantity: { amount: 100, unit: 'g', grams: 100 },
  calories: 100, protein: 1, carbs: 1, fat: 1, fiber: 0, sugar: 0, sodium: 0, cholesterol: 0,
  icon: 'default', photoRef: null, manualFields: [],
  review: { state: 'provisional', startedAt, source },
  ...over,
});
const magazine = (n, at) => row({ id: `mag-${n}`, item: 'Magazine', startedAt: `2026-09-21T21:50:${at}Z`, photoRef: 'ph_placeholder', ...NULL_NUTRIENTS });

const rows = () => [
  // Six re-fires 1–3 s apart; only the first survives.
  magazine(1, '11.000'), magazine(2, '12.500'), magazine(3, '14.000'),
  magazine(4, '17.000'), magazine(5, '19.500'), magazine(6, '22.000'),
  // Two milkshakes 0.4 s apart on 09-19, and one on 09-18 that is not a repeat.
  row({ id: 'shake-1', item: 'Strawberry Milkshake', date: '2026-09-19', calories: 390, icon: 'milkshake', startedAt: '2026-09-19T03:19:06.100Z' }),
  row({ id: 'shake-2', item: 'Strawberry Milkshake', date: '2026-09-19', calories: 390, icon: 'milkshake', startedAt: '2026-09-19T03:19:06.500Z' }),
  row({ id: 'shake-3', item: 'Strawberry Milkshake', date: '2026-09-18', calories: 390, icon: 'milkshake', startedAt: '2026-09-18T03:19:06.300Z' }),
  // OFF said ml; the label says 170 g. Also shouting.
  row({ id: 'oikos', item: 'OIKOS PRO PLAIN', unit: 'ml', amount: 170, grams: null, icon: 'yogurt',
    originalQuantity: { amount: 170, unit: 'ml', grams: null }, version: 2 }),
  // A person typed this name; it is theirs even though it shouts.
  row({ id: 'spinach', item: 'BABY SPINACH', manualFields: ['name'], icon: 'salad' }),
  // Retired flat icons.
  row({ id: 'feta', item: 'Feta Cheese', icon: 'cheese', source: 'text' }),
  row({ id: 'string', item: 'Galbani String Cheese', icon: 'string_cheese', source: 'text' }),
  row({ id: 'plate', item: 'Mystery Plate', icon: '🍽️', source: 'image' }),
  // Duplicated word, only fixed through the explicit renames map.
  row({ id: 'cheddar', item: 'Sharp Cheddar Cheddar Cheese', icon: 'cheese' }),
  // A store-brand scan with no nutrition, chosen for deletion by a person.
  row({ id: 'winco', item: 'Winco Foods', ...NULL_NUTRIENTS }),
  // A real photo stays; a reviewed name on a 'default' row gets its icon.
  row({ id: 'pita', item: 'Pita Bread', photoRef: 'ph_real', source: 'text' }),
];

const options = (over = {}) => ({
  placeholderPhotoRefs: new Set(['ph_placeholder']),
  labelGrams: { 'OIKOS PRO PLAIN': 170 },
  iconByName: { 'feta cheese': 'feta-cubes', 'sharp cheddar cheese': 'cheddar-wedge', 'baby spinach': 'spinach', 'pita bread': 'pita-bread' },
  offered: new Set(['milkshake', 'yogurt', 'salad', 'spinach', 'feta-cubes', 'cheddar-wedge', 'pita-bread']),
  renames: { 'Sharp Cheddar Cheddar Cheese': 'Sharp Cheddar Cheese' },
  deleteIds: ['winco'],
  ...over,
});

describe('planScanDataRepair', () => {
  it('deletes re-fires within 30 s and the explicitly chosen ids', () => {
    const plan = planScanDataRepair(rows(), options());
    expect(plan.deleteIds).toEqual(['mag-2', 'mag-3', 'mag-4', 'mag-5', 'mag-6', 'shake-2', 'winco']);
  });

  it('plans exactly these updates, each carrying the row version', () => {
    const plan = planScanDataRepair(rows(), options());
    expect(plan.updates.map(({ reasons, ...update }) => update)).toEqual([
      { id: 'mag-1', expectedVersion: 1, changes: { photoRef: null } },
      { id: 'oikos', expectedVersion: 2, changes: { name: 'Oikos Pro Plain', grams: 170, unit: 'g', amount: 170 } },
      { id: 'spinach', expectedVersion: 1, changes: { icon: 'spinach' } },
      { id: 'feta', expectedVersion: 1, changes: { icon: 'feta-cubes' } },
      { id: 'string', expectedVersion: 1, changes: { icon: 'default' } },
      { id: 'plate', expectedVersion: 1, changes: { icon: 'default' } },
      { id: 'cheddar', expectedVersion: 1, changes: { name: 'Sharp Cheddar Cheese', icon: 'cheddar-wedge' } },
      { id: 'pita', expectedVersion: 1, changes: { icon: 'pita-bread' } },
    ]);
    expect(plan.updates.find(u => u.id === 'cheddar').reasons).toEqual(['rename', 'retired-icon']);
  });

  it('never renames a name a person set', () => {
    const plan = planScanDataRepair(rows(), options());
    expect(plan.updates.find(u => u.id === 'spinach').changes).not.toHaveProperty('name');
  });

  it('reports surviving UPC rows with no nutrition, without changing them', () => {
    const plan = planScanDataRepair(rows(), options({ deleteIds: [] }));
    expect(plan.report.emptyUpc.map(r => r.id)).toEqual(['mag-1', 'winco']);
  });

  it('scales a partial portion by the label grams', () => {
    const plan = planScanDataRepair([row({ id: 'half', item: 'OIKOS PRO PLAIN', unit: 'ml', amount: 85, grams: null,
      originalQuantity: { amount: 170, unit: 'ml', grams: null }, manualFields: ['name'] })], options({ deleteIds: [] }));
    expect(plan.updates[0].changes).toEqual({ grams: 85, unit: 'g', amount: 85 });
  });

  it('leaves an ml row alone when its serving basis is not ml, and reports it', () => {
    const plan = planScanDataRepair([row({ id: 'odd', item: 'OIKOS PRO PLAIN', unit: 'ml', amount: 170, grams: null,
      originalQuantity: { amount: 1, unit: 'g', grams: null }, manualFields: ['name'] })], options({ deleteIds: [] }));
    expect(plan.updates).toEqual([]);
    expect(plan.report.mlUnresolved).toEqual([{ id: 'odd', name: 'OIKOS PRO PLAIN', reason: 'serving basis is g, not ml' }]);
  });

  it('a person\'s icon choice is kept against the reviewed table, but a retired one is still replaced', () => {
    const plan = planScanDataRepair([
      row({ id: 'kept', item: 'Pita Bread', icon: 'salad', manualFields: ['icon'], source: 'text' }),
      row({ id: 'flat', item: 'Pita Bread', icon: 'pitasandwich', manualFields: ['icon'], source: 'text' }),
    ], options({ deleteIds: [] }));
    expect(plan.updates.map(u => [u.id, u.changes])).toEqual([['flat', { icon: 'pita-bread' }]]);
  });

  it('counts a row stored in both the hot file and an archive once', () => {
    const plan = planScanDataRepair([...rows(), row({ id: 'feta', item: 'Feta Cheese', icon: 'cheese', source: 'text' })], options());
    expect(plan.updates.filter(u => u.id === 'feta')).toHaveLength(1);
  });

  it('refuses a chosen delete id that is not in the ledger', () => {
    expect(() => planScanDataRepair(rows(), options({ deleteIds: ['nope'] }))).toThrow(/nope/);
  });

  it('refuses an icon table target that is not offered (never propose flat art)', () => {
    expect(() => planScanDataRepair(rows(), options({ iconByName: { 'feta cheese': 'cheese' } }))).toThrow(/cheese/);
  });

  it('an icon table value of null means no suitable art: default', () => {
    const plan = planScanDataRepair(rows(), options({ iconByName: { 'feta cheese': null } }));
    expect(plan.updates.find(u => u.id === 'feta').changes).toEqual({ icon: 'default' });
  });
});

describe('planCatalogIconRepair', () => {
  const entry = (over) => ({ id: over.id, name: over.name, normalizedName: over.name.toLowerCase(), icon: null, iconOverride: null, ...over });
  const catalog = () => [
    entry({ id: 'c-feta', name: 'Feta Cheese', icon: 'cheese' }),
    entry({ id: 'c-pita', name: 'Pita', icon: 'pita-bread', iconOverride: 'pitasandwich' }),
    entry({ id: 'c-string', name: 'Galbani STRING CHEESE', icon: 'string_cheese' }),
    entry({ id: 'c-ok', name: 'Kale', icon: 'spinach' }),
    entry({ id: 'c-oikos', name: 'OIKOS PRO PLAIN', icon: 'yogurt' }),
    entry({ id: 'c-oikos-2', name: 'Oikos Pro Plain', icon: 'yogurt' }),
    entry({ id: 'c-cheddar', name: 'Sharp Cheddar Cheddar Cheese', icon: 'cheddar-wedge' }),
  ];
  const opts = {
    iconByName: { 'feta cheese': 'feta-cubes' },
    offered: new Set(['pita-bread', 'spinach', 'yogurt', 'feta-cubes', 'cheddar-wedge']),
    renames: { 'Sharp Cheddar Cheddar Cheese': 'Sharp Cheddar Cheese' },
  };

  // A catalog entry with no reviewed icon gets null, not 'default': the
  // catalog never stores the neutral sentinel (FoodCatalogService.isRealIcon),
  // because a stored 'default' blocks every later capture from filling it.
  it('re-icons non-offered icons by name (null when unknown) and clears a non-offered pin', () => {
    const plan = planCatalogIconRepair(catalog(), opts);
    expect(plan.iconUpdates).toEqual([
      { id: 'c-feta', name: 'Feta Cheese', from: { icon: 'cheese', iconOverride: null }, icon: 'feta-cubes', iconOverride: null },
      { id: 'c-pita', name: 'Pita', from: { icon: 'pita-bread', iconOverride: 'pitasandwich' }, icon: 'pita-bread', iconOverride: null },
      { id: 'c-string', name: 'Galbani STRING CHEESE', from: { icon: 'string_cheese', iconOverride: null }, icon: null, iconOverride: null },
    ]);
  });

  it('a reviewed name moves an offered icon, unless a person pinned an offered one', () => {
    const plan = planCatalogIconRepair([
      entry({ id: 'a', name: 'Feta Cheese', icon: 'yogurt' }),
      entry({ id: 'b', name: 'feta cheese ', icon: 'yogurt', iconOverride: 'spinach' }),
    ], opts);
    expect(plan.iconUpdates).toEqual([
      { id: 'a', name: 'Feta Cheese', from: { icon: 'yogurt', iconOverride: null }, icon: 'feta-cubes', iconOverride: null },
    ]);
  });

  it('plans name normalization and skips a rename that would collide', () => {
    const plan = planCatalogIconRepair(catalog(), opts);
    expect(plan.renames).toEqual([
      { id: 'c-string', from: 'Galbani STRING CHEESE', to: 'Galbani String Cheese' },
      { id: 'c-cheddar', from: 'Sharp Cheddar Cheddar Cheese', to: 'Sharp Cheddar Cheese' },
    ]);
    // The lowercase key already collides with a second entry: updateDefinition
    // would 409 on it, so it is skipped and reported.
    expect(plan.skippedRenames).toEqual([{ id: 'c-oikos', from: 'OIKOS PRO PLAIN', to: 'Oikos Pro Plain', conflictId: 'c-oikos-2' }]);
    const clash = planCatalogIconRepair([...catalog(), entry({ id: 'c-x', name: 'Sharp Cheddar Cheese' })], opts);
    expect(clash.skippedRenames).toContainEqual({ id: 'c-cheddar', from: 'Sharp Cheddar Cheddar Cheese', to: 'Sharp Cheddar Cheese', conflictId: 'c-x' });
  });
});
