import { describe, it, expect } from 'vitest';
import {
  mineTemplates, coreKey,
  MINER_WINDOW_DAYS, MIN_OCCURRENCES, CORE_PRESENCE, VARIANT_MIN_PRESENCE, MIN_CORE_COMPONENTS,
} from './TemplateMiner.mjs';

const TODAY = '2026-09-04';

// Assert the LITERALS the PRD specifies, separately from the constants that
// implement them. A test that only compared a threshold to its own constant
// would follow the constant wherever it moved and stay green — the Phase 9
// half-life defect. Both halves have to be stated for either to mean anything.
describe('the mining parameters are the ones the PRD specifies', () => {
  it('mines a 90-day window', () => expect(MINER_WINDOW_DAYS).toBe(90));
  it('needs 6 occurrences', () => expect(MIN_OCCURRENCES).toBe(6));
  it('calls 70% presence core', () => expect(CORE_PRESENCE).toBe(0.7));
  it('calls 20% presence the variant floor', () => expect(VARIANT_MIN_PRESENCE).toBe(0.2));
  it('needs 2 core components', () => expect(MIN_CORE_COMPONENTS).toBe(2));
});

/** `n` days before TODAY. */
const daysAgo = (n) => {
  const at = new Date(`${TODAY}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - n);
  return at.toISOString().slice(0, 10);
};

/** One eating event: a bucket on a day holding these named foods. */
const meal = (date, names, { mealTime = 'morning', calories = 100, parentId = null } = {}) =>
  names.map((name, i) => ({
    uuid: `${date}-${mealTime}-${i}`, name, date, mealTime, parentId,
    calories, protein: 1, carbs: 2, fat: 3, kind: 'item',
  }));

/** `count` days of the same stack, most recent first. */
const repeat = (count, names, opts = {}) =>
  Array.from({ length: count }, (_, i) => meal(daysAgo(i + 1), names, opts)).flat();

const mine = (rows, extra = {}) => mineTemplates({ rows, today: TODAY, ...extra });

describe('occurrence threshold', () => {
  it('proposes nothing at FIVE occurrences', () => {
    expect(mine(repeat(5, ['Chia', 'Whey']))).toEqual([]);
  });

  it('proposes at SIX — the literal the PRD names', () => {
    const [proposal] = mine(repeat(6, ['Chia', 'Whey']));
    expect(proposal).toBeTruthy();
    expect(proposal.occurrences).toBe(6);
    expect(proposal.components.map((c) => c.name)).toEqual(['Chia', 'Whey']);
    expect(proposal.components.every((c) => c.role === 'core')).toBe(true);
  });
});

describe('core / variant / dropped boundaries', () => {
  // Ten occurrences makes each one worth exactly 10%, so a presence count IS a
  // percentage and each boundary can be hit exactly from both sides.
  const tenBase = () => repeat(10, ['Chia', 'Whey']);
  const withExtra = (times, extraName) => {
    const rows = tenBase();
    for (let i = 0; i < times; i += 1) rows.push(...meal(daysAgo(i + 1), [extraName]));
    return rows;
  };

  it('7 of 10 (exactly 70%) is CORE; 6 of 10 (60%) is only a variant', () => {
    const atCore = mine(withExtra(7, 'Greens'))[0];
    expect(atCore.components.find((c) => c.name === 'Greens').role).toBe('core');
    const below = mine(withExtra(6, 'Greens'))[0];
    expect(below.components.find((c) => c.name === 'Greens').role).toBe('variant');
  });

  it('2 of 10 (exactly 20%) is a VARIANT; 1 of 10 (10%) is dropped entirely', () => {
    const atVariant = mine(withExtra(2, 'Mango'))[0];
    expect(atVariant.components.find((c) => c.name === 'Mango').role).toBe('variant');
    const below = mine(withExtra(1, 'Mango'))[0];
    expect(below.components.find((c) => c.name === 'Mango')).toBeUndefined();
  });

  // 20 occurrences resolves to 5-point steps, which pins the threshold from
  // BOTH sides: the 10-occurrence cases above cannot tell 0.7 from 0.65,
  // because nothing lands between 0.6 and 0.7 to distinguish them.
  const twentyBase = () => repeat(20, ['Chia', 'Whey']);
  const withExtraOf20 = (times, extraName) => {
    const rows = twentyBase();
    for (let i = 0; i < times; i += 1) rows.push(...meal(daysAgo(i + 1), [extraName]));
    return rows;
  };

  it('13 of 20 (65%) is still only a variant — the core line is at 0.70, not below it', () => {
    expect(mine(withExtraOf20(13, 'Greens'))[0].components.find((c) => c.name === 'Greens').role).toBe('variant');
    expect(mine(withExtraOf20(14, 'Greens'))[0].components.find((c) => c.name === 'Greens').role).toBe('core');
  });

  it('3 of 20 (15%) is dropped — the variant floor is at 0.20, not below it', () => {
    expect(mine(withExtraOf20(3, 'Mango'))[0].components.find((c) => c.name === 'Mango')).toBeUndefined();
    expect(mine(withExtraOf20(4, 'Mango'))[0].components.find((c) => c.name === 'Mango').role).toBe('variant');
  });

  it('a variant is offered but never included in the core key', () => {
    const proposal = mine(withExtra(4, 'Mango'))[0];
    expect(proposal.components.find((c) => c.name === 'Mango').role).toBe('variant');
    expect(proposal.key).toBe(coreKey(['Chia', 'Whey']));
    expect(proposal.key).not.toContain('mango');
  });
});

describe('the 90-day window', () => {
  it('a stack that stopped 91 days ago is out; the same stack ending 89 days ago is in', () => {
    const old = Array.from({ length: 6 }, (_, i) => meal(daysAgo(91 + i), ['Chia', 'Whey'])).flat();
    expect(mine(old)).toEqual([]);
    const recent = Array.from({ length: 6 }, (_, i) => meal(daysAgo(84 + i), ['Chia', 'Whey'])).flat();
    expect(mine(recent)).toHaveLength(1);
  });

  it('a row dated exactly 90 days back still counts; 91 does not', () => {
    const five = Array.from({ length: 5 }, (_, i) => meal(daysAgo(i + 1), ['Chia', 'Whey'])).flat();
    expect(mine([...five, ...meal(daysAgo(90), ['Chia', 'Whey'])])).toHaveLength(1);
    expect(mine([...five, ...meal(daysAgo(91), ['Chia', 'Whey'])])).toEqual([]);
  });

  it('honours a narrower window when asked for one', () => {
    const rows = Array.from({ length: 6 }, (_, i) => meal(daysAgo(i + 20), ['Chia', 'Whey'])).flat();
    expect(mine(rows, { windowDays: 90 })).toHaveLength(1);
    expect(mine(rows, { windowDays: 10 })).toEqual([]);
  });
});

describe('what counts as one occurrence', () => {
  it('the same bucket on the same day is ONE occurrence, however many rows', () => {
    // Six days, but the stack is split across two writes each day.
    const rows = Array.from({ length: 6 }, (_, i) => [
      ...meal(daysAgo(i + 1), ['Chia']),
      ...meal(daysAgo(i + 1), ['Whey']),
    ]).flat();
    expect(mine(rows)[0].occurrences).toBe(6);
  });

  it('two different buckets on one day are two DIFFERENT occurrences', () => {
    const morning = Array.from({ length: 3 }, (_, i) => meal(daysAgo(i + 1), ['Chia', 'Whey'], { mealTime: 'morning' })).flat();
    const evening = Array.from({ length: 3 }, (_, i) => meal(daysAgo(i + 1), ['Chia', 'Whey'], { mealTime: 'evening' })).flat();
    // 3 + 3 = 6 occurrences of the same stack, so it clears the threshold only
    // because they are counted separately.
    expect(mine([...morning, ...evening])[0].occurrences).toBe(6);
  });

  it('a group is one occurrence even when two groups share a bucket and day', () => {
    const rows = Array.from({ length: 6 }, (_, i) => [
      ...meal(daysAgo(i + 1), ['Chia', 'Whey'], { parentId: `g-a-${i}` }),
      ...meal(daysAgo(i + 1), ['Rice', 'Beans'], { parentId: `g-b-${i}` }),
    ]).flat();
    const proposals = mine(rows);
    expect(proposals).toHaveLength(2);
    expect(proposals.every((p) => p.occurrences === 6)).toBe(true);
    // Two stacks that always share a day are NOT one combo, because the group
    // splits them — the thing a day+bucket key alone would get wrong.
    expect(proposals.map((p) => p.key).sort()).toEqual([coreKey(['Chia', 'Whey']), coreKey(['Rice', 'Beans'])].sort());
  });

  it('ignores group header rows — a proposal is never a list of dish names', () => {
    // The real shape: a Smoothie group with two children, and a loose coffee
    // in the same bucket on the same day. Count the header as a component and
    // "Smoothie + Coffee" becomes a combo of a DISH NAME and a drink — a
    // template whose first item carries zero calories by design.
    const rows = Array.from({ length: 6 }, (_, i) => [
      { uuid: `g-${i}`, name: 'Smoothie', date: daysAgo(i + 1), mealTime: 'morning', kind: 'group', parentId: null, calories: 0 },
      ...meal(daysAgo(i + 1), ['Chia', 'Whey'], { parentId: `g-${i}` }),
      ...meal(daysAgo(i + 1), ['Coffee'], { calories: 5 }),
    ]).flat();
    const proposals = mine(rows);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].components.map((c) => c.name)).toEqual(['Chia', 'Whey']);
    expect(proposals.flatMap((p) => p.components.map((c) => c.name))).not.toContain('Smoothie');
  });

  it('ignores uncounted rows — a pending capture is not evidence of a habit', () => {
    const rows = repeat(6, ['Chia', 'Whey']).map((r) => ({ ...r, status: 'pending' }));
    expect(mine(rows)).toEqual([]);
  });

  it('needs at least two distinct foods in an occurrence', () => {
    expect(mine(repeat(10, ['Coffee']))).toEqual([]);
  });
});

describe('dedup and dismissal', () => {
  const rows = repeat(6, ['Chia', 'Whey']);

  it('a key already held by a template or a live proposal is not re-proposed', () => {
    expect(mine(rows, { existingKeys: [coreKey(['Chia', 'Whey'])] })).toEqual([]);
  });

  it('a DISMISSED key is never proposed again', () => {
    expect(mine(rows, { dismissedKeys: [coreKey(['Whey', 'Chia'])] })).toEqual([]);
  });

  it('the key is order-independent and case-insensitive, so a dismissal cannot be evaded', () => {
    expect(coreKey(['Chia', 'Whey'])).toBe(coreKey(['whey', ' CHIA ']));
    expect(mine(rows, { dismissedKeys: [coreKey([' whey ', 'Chia'])] })).toEqual([]);
  });

  it('a name the picker already shows is not proposed a second time', () => {
    const [proposal] = mine(rows);
    expect(proposal.suggestedName).toBe('Morning chia');
    expect(mine(rows, { existingTemplateNames: ['morning   CHIA'] })).toEqual([]);
  });

  it('two anchors inside one stack yield ONE proposal, not one per component', () => {
    expect(mine(repeat(8, ['Chia', 'Whey', 'Greens']))).toHaveLength(1);
  });

  it('a combo whose core is a single food is not proposed', () => {
    // Chia every day; the partner rotates, so no second food reaches 70%.
    const rows2 = [
      ...Array.from({ length: 4 }, (_, i) => meal(daysAgo(i + 1), ['Chia', 'Whey'])).flat(),
      ...Array.from({ length: 4 }, (_, i) => meal(daysAgo(i + 5), ['Chia', 'Oats'])).flat(),
    ];
    expect(mine(rows2)).toEqual([]);
  });
});

describe('the proposal itself', () => {
  it('carries the MOST RECENT real portion, never an invented average', () => {
    const rows = repeat(6, ['Chia', 'Whey']);
    // Yesterday's chia was a double scoop.
    rows.push({ uuid: 'recent', name: 'Chia', date: daysAgo(1), mealTime: 'morning', calories: 240, protein: 8, carbs: 10, fat: 16, grams: 24, unit: 'g', amount: 24, kind: 'item' });
    const chia = mine(rows)[0].components.find((c) => c.name === 'Chia');
    expect(chia.calories).toBe(240);
    expect(chia.grams).toBe(24);
    expect(chia.unit).toBe('g');
  });

  it('names itself after the dominant bucket and the highest-presence core food', () => {
    // Both are present in every occurrence, so presence ties and the
    // substantial food wins the name — not the alphabetically first one.
    const day = (n, mealTime) => [
      ...meal(daysAgo(n), ['Oatmeal'], { mealTime, calories: 300 }),
      ...meal(daysAgo(n), ['Coffee'], { mealTime, calories: 5 }),
    ];
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => day(i + 1, 'morning')).flat(),
      ...Array.from({ length: 2 }, (_, i) => day(i + 20, 'evening')).flat(),
    ];
    const proposal = mine(rows)[0];
    expect(proposal.mealTime).toBe('morning');
    expect(proposal.suggestedName).toBe('Morning oatmeal');
  });

  it('is deterministic — the same rows in a different order mine the same proposals', () => {
    const rows = repeat(8, ['Chia', 'Whey', 'Greens']);
    const forward = mine(rows);
    const backward = mine([...rows].reverse());
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });

  it('returns nothing without a `today` — it will not invent the window it mines', () => {
    expect(mineTemplates({ rows: repeat(6, ['Chia', 'Whey']) })).toEqual([]);
  });
});
