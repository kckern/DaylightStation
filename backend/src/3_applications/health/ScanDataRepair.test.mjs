import { describe, it, expect } from 'vitest';
import { planScanDataRepair, planCatalogIconRepair, manifestVocabulary } from './ScanDataRepair.mjs';
import { NUTRIENT_KEYS } from '#shared/contracts/health/foodQuantity.mjs';

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

  it('reports each re-fire against the row that survives, with its delay', () => {
    const plan = planScanDataRepair(rows(), options());
    expect(plan.report.duplicates.slice(0, 2)).toEqual([
      { id: 'mag-2', keptId: 'mag-1', name: 'Magazine', date: '2026-09-21', secondsAfter: 1.5 },
      { id: 'mag-3', keptId: 'mag-1', name: 'Magazine', date: '2026-09-21', secondsAfter: 3 },
    ]);
  });

  it('counts retired slugs that fell through to default with no table hit', () => {
    const plan = planScanDataRepair(rows(), options());
    expect(plan.report.fellThroughToDefault).toEqual({ string_cheese: 1, '🍽️': 1 });
  });

  it('an alias with an offered twin becomes the twin; an alias without one is kept', () => {
    const plan = planScanDataRepair([
      row({ id: 'pb', item: 'Peanut Butter', icon: 'peanut_butter', source: 'text' }),
      row({ id: 'chick', item: 'Chickpeas', icon: 'chickpea', source: 'text' }),
    ], options({ deleteIds: [], aliases: { peanut_butter: 'peanut-butter', chickpea: 'chickpea' },
      offered: new Set(['peanut-butter']), iconByName: {} }));
    expect(plan.updates.map(u => [u.id, u.changes, u.reasons])).toEqual([['pb', { icon: 'peanut-butter' }, ['alias-icon']]]);
    expect(plan.report.fellThroughToDefault).toEqual({});
  });

  it('never converts ml a person set, and keeps full precision to the ledger\'s two decimals', () => {
    const plan = planScanDataRepair([
      row({ id: 'set', item: 'OIKOS PRO PLAIN', unit: 'ml', amount: 170, grams: null, source: 'text',
        originalQuantity: { amount: 170, unit: 'ml' }, manualFields: ['amount'] }),
      row({ id: 'odd', item: 'Mexican Style 4 Cheese Blend', unit: 'ml', amount: 28.25, grams: null, source: 'text',
        originalQuantity: { amount: 30, unit: 'ml' } }),
    ], options({ deleteIds: [], labelGrams: { 'OIKOS PRO PLAIN': 170, 'Mexican Style 4 Cheese Blend': 28 } }));
    expect(plan.report.mlUnresolved).toEqual([{ id: 'set', name: 'OIKOS PRO PLAIN', reason: 'portion set by a person (amount)' }]);
    expect(plan.updates).toEqual([{ id: 'odd', expectedVersion: 1, changes: { grams: 26.37, unit: 'g', amount: 26.37 }, reasons: ['ml-to-grams'] }]);
  });

  it('records the label ml serving seen on the ledger for the catalog', () => {
    expect(planScanDataRepair(rows(), options()).report.labelServingMl).toEqual({ 'OIKOS PRO PLAIN': 170 });
  });

  it('takes the most common ml serving, and leaves a tie ambiguous', () => {
    const oikos = (id, serving) => row({ id, item: 'OIKOS PRO PLAIN', unit: 'ml', amount: serving, grams: null, source: 'text',
      startedAt: `2026-09-2${id.length}T00:00:00Z`, originalQuantity: { amount: serving, unit: 'ml' } });
    const majority = planScanDataRepair([oikos('a', 170), oikos('bb', 170), oikos('ccc', 1)], options({ deleteIds: [] })).report;
    expect(majority.labelServingMl).toEqual({ 'OIKOS PRO PLAIN': 170 });
    const tie = planScanDataRepair([oikos('a', 170), oikos('ccc', 1)], options({ deleteIds: [] })).report;
    expect(tie.labelServingMl).toEqual({});
    expect(tie.labelServingAmbiguous).toEqual({ 'OIKOS PRO PLAIN': { 170: 1, 1: 1 } });
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

  it('maps an alias icon or pin to its offered twin and keeps a twinless alias', () => {
    const plan = planCatalogIconRepair([
      entry({ id: 'a', name: 'Peanut Butter', icon: 'peanut_butter', iconOverride: 'peanut_butter' }),
      entry({ id: 'b', name: 'Chickpeas', icon: 'chickpea' }),
    ], { ...opts, aliases: { peanut_butter: 'peanut-butter', chickpea: 'chickpea' }, offered: new Set(['peanut-butter', 'feta-cubes']) });
    expect(plan.iconUpdates).toEqual([
      { id: 'a', name: 'Peanut Butter', from: { icon: 'peanut_butter', iconOverride: 'peanut_butter' }, icon: 'peanut-butter', iconOverride: 'peanut-butter' },
    ]);
  });

  it('counts retired icons that fell through to null, and cleared pins', () => {
    const plan = planCatalogIconRepair(catalog(), opts);
    expect(plan.fellThroughToNull).toEqual({ string_cheese: 1 });
    expect(plan.pinsCleared).toEqual({ pitasandwich: 1 });
  });

  it('converts remembered ml portions to grams from the label, and reports what it cannot', () => {
    const plan = planCatalogIconRepair([
      entry({ id: 'o', name: 'OIKOS PRO PLAIN', icon: 'yogurt', usageByBucket: {
        afternoon: { count: 4, lastUsed: '2026-09-11', quantity: { grams: 0, unit: 'ml', amount: 170 } },
        morning: { count: 1, lastUsed: '2026-09-01', quantity: { grams: 170, unit: 'g', amount: 170 } } } }),
      entry({ id: 's', name: 'Spring Mix', icon: 'garden-salad', usageByBucket: {
        afternoon: { count: 1, lastUsed: '2026-09-11', quantity: { grams: 0, unit: 'ml', amount: 85 } } } }),
      entry({ id: 'r', name: 'Ranch', usageByBucket: { afternoon: { count: 1, quantity: { grams: 0, unit: 'ml', amount: 30 } } } }),
    ], { ...opts, labelGrams: { 'OIKOS PRO PLAIN': 170, 'Spring Mix': 85 }, labelServingMl: { 'OIKOS PRO PLAIN': 170 } });
    expect(plan.quantityUpdates).toEqual([
      { id: 'o', name: 'OIKOS PRO PLAIN', bucket: 'afternoon', from: { grams: 0, unit: 'ml', amount: 170 }, to: { grams: 170, unit: 'g', amount: 170 } },
    ]);
    expect(plan.quantityUnresolved).toEqual([{ id: 's', name: 'Spring Mix', bucket: 'afternoon', reason: 'no ml serving seen on the ledger' }]);
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

describe('manifestVocabulary', () => {
  it('offers hi-res icons, twins aliases by path, keeps twinless aliases, drops flat art', () => {
    expect(manifestVocabulary({
      icons: { 'peanut-butter': { path: 'img/nutrition/icons/vegan-food/peanut-butter.png' }, cheese: { path: 'img/icons/food/cheese.png' } },
      aliases: {
        peanut_butter: { path: 'img/nutrition/icons/vegan-food/peanut-butter.png' },
        chickpea: { path: 'img/nutrition/icons/healthy-food/chickpeas.png' },
        pitasandwich: { path: 'img/icons/food/pitasandwich.png' },
      },
    })).toEqual({ offered: ['peanut-butter'], aliases: { peanut_butter: 'peanut-butter', chickpea: 'chickpea' } });
  });
});

describe('legacy-quantity rule', () => {
  // Legacy rows: the nutribot stored grams in originalQuantity.amount under a
  // household label, and the ledger kept unit g with no amount.
  const legacy = (id, name, originalQuantity, calories, over = {}) => row({
    id, item: name, source: 'text', unit: 'g', amount: null, grams: null, originalQuantity, calories, ...over,
  });
  const ledger = () => [
    legacy('kale', 'Kale', { amount: 134, unit: 'cup' }, 45),
    legacy('seeds', 'Sunflower Seeds', { amount: 34, unit: 'tbsp' }, 200),
    legacy('carrot', 'Sliced Carrots', { amount: 84, unit: 'serving' }, 34),
    legacy('water', 'Sparkling Water', { amount: 50, unit: 'piece' }, 0),
    legacy('milk', 'Milk', { amount: 325, unit: 'mL' }, 150),
    legacy('soda', 'Soda', { amount: 0.33, unit: 'Litres' }, 140),
    legacy('rice', 'Rice', { amount: 1, unit: 'cup' }, 200),
    legacy('typo', 'Premier Protein', { amount: 3, unit: 'ml' }, 480),
    legacy('zero-ml', 'Water', { amount: 250, unit: 'ml' }, 0),
    legacy('coffee', 'Black Coffee', { amount: 500, unit: 'ml' }, 2),
    legacy('blank', 'Mystery', { amount: null, unit: 'g' }, 90),
    legacy('mine', 'Oatmeal', { amount: 1, unit: 'cup' }, 150, { manualFields: ['amount'] }),
    legacy('uncal', 'Broth', { amount: 240, unit: 'cup' }, null),
    legacy('grp', 'Lunch', { amount: 300, unit: 'g' }, 500, { kind: 'group' }),
    // Already has a mass: not this rule's business.
    row({ id: 'fine', item: 'Apple', source: 'text' }),
  ];
  const plan = () => planScanDataRepair(ledger(), { offered: [] });
  const changesOf = (p, id) => p.updates.find(update => update.id === id)?.changes;

  it('reads a plausible legacy amount as grams, with provenance', () => {
    const p = plan();
    expect(changesOf(p, 'kale')).toEqual({ grams: 134, amount: 134, unit: 'g',
      quantityProvenance: { source: 'legacy-amount', label: 'cup' } });
    expect(changesOf(p, 'seeds')).toEqual({ grams: 34, amount: 34, unit: 'g',
      quantityProvenance: { source: 'legacy-amount', label: 'tbsp' } });
    expect(changesOf(p, 'carrot').grams).toBe(84);
    expect(p.updates.find(update => update.id === 'kale')).toMatchObject({ expectedVersion: 1, reasons: ['legacy-quantity'] });
  });

  it('accepts any positive amount as grams when calories are zero', () => {
    expect(changesOf(plan(), 'water')).toEqual({ grams: 50, amount: 50, unit: 'g',
      quantityProvenance: { source: 'legacy-amount', label: 'piece' } });
  });

  it('restores a metric volume verbatim, normalized, with no grams', () => {
    const p = plan();
    expect(changesOf(p, 'milk')).toEqual({ amount: 325, unit: 'ml' });
    expect(changesOf(p, 'soda')).toEqual({ amount: 0.33, unit: 'l' });
    expect(p.report.legacyQuantity.find(entry => entry.id === 'soda')).toMatchObject({ kind: 'volume', density: 0.42 });
    expect(changesOf(p, 'zero-ml')).toEqual({ amount: 250, unit: 'ml' });
    // Only the ceiling applies to a volume: thin drinks are real.
    expect(changesOf(p, 'coffee')).toEqual({ amount: 500, unit: 'ml' });
  });

  it('reports what it cannot resolve and changes nothing there', () => {
    const p = plan();
    for (const id of ['rice', 'typo', 'blank', 'mine', 'uncal', 'grp', 'fine']) expect(changesOf(p, id)).toBeUndefined();
    expect(p.report.legacyQuantityUnresolved).toEqual([
      { id: 'rice', name: 'Rice', originalQuantity: { amount: 1, unit: 'cup' }, calories: 200,
        reason: '200 kcal/g is outside 0.05-9.5 if the amount were grams' },
      { id: 'typo', name: 'Premier Protein', originalQuantity: { amount: 3, unit: 'ml' }, calories: 480,
        reason: '160 kcal/g is above 9.5 if the amount were ml' },
      { id: 'blank', name: 'Mystery', originalQuantity: { amount: null, unit: 'g' }, calories: 90, reason: 'no original amount' },
    ]);
  });

  it('never changes a nutrient and converges', () => {
    const rows = ledger();
    const p = planScanDataRepair(rows, { offered: [] });
    for (const { changes } of p.updates) for (const key of Object.keys(changes)) expect(NUTRIENT_KEYS).not.toContain(key);
    const applied = rows.map(r => {
      const update = p.updates.find(u => u.id === r.id);
      return update ? { ...r, ...update.changes, version: r.version + 1 } : r;
    });
    const again = planScanDataRepair(applied, { offered: [] });
    expect(again.updates).toEqual([]);
    expect(again.report.legacyQuantity).toEqual([]);
  });
});
