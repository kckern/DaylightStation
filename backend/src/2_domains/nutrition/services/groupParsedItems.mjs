/**
 * Group Parsed Items
 * @module nutrition/services/groupParsedItems
 *
 * Pure mapper: turns the flat AI-parsed items array (each item optionally
 * carrying a `dish` tag) into the flat entry list the storage layer expects —
 * `kind: 'item'` for standalone foods, or one synthesized `kind: 'group'`
 * entry per distinct `dish` value followed by its members (`parentId` set to
 * the group's id).
 *
 * No clock, no randomness, no IO — the caller injects `makeId` for every id
 * this function needs to mint (domain layer must stay deterministic).
 */

/**
 * @param {Array<Object>} items - Parsed food items; each MAY carry a `dish` string.
 * @param {{ makeId: () => string }} deps - Injected id factory (e.g. the use case's uuidv4).
 * @returns {Array<Object>} Flat entries: groups immediately followed by their members.
 */
export function groupParsedItems(items, { makeId } = {}) {
  if (typeof makeId !== 'function') {
    throw new Error('groupParsedItems requires a makeId() function');
  }
  if (!Array.isArray(items) || items.length === 0) return [];

  // Pass 1: collect members per distinct dish, in first-appearance order.
  const dishOrder = [];
  const membersByDish = new Map();
  for (const item of items) {
    const dish = item && item.dish;
    if (!dish) continue;
    if (!membersByDish.has(dish)) {
      membersByDish.set(dish, []);
      dishOrder.push(dish);
    }
    membersByDish.get(dish).push(item);
  }

  // Build one synthesized group entry per dish. Group rows carry ZERO
  // nutrition — totals are rolled up from children at read time, so summing
  // nutrition here would double-count.
  const groupsByDish = new Map();
  for (const dish of dishOrder) {
    const members = membersByDish.get(dish);

    const totalGrams = members.reduce((sum, m) => sum + (typeof m.grams === 'number' ? m.grams : 0), 0);
    const grams = Math.min(10000, Math.max(1, totalGrams || 1));

    // Most common member color; ties resolve to the first member's color.
    const colorCounts = new Map();
    for (const m of members) colorCounts.set(m.color, (colorCounts.get(m.color) || 0) + 1);
    let color = members[0].color;
    let bestCount = 0;
    for (const m of members) {
      const count = colorCounts.get(m.color);
      if (count > bestCount) {
        bestCount = count;
        color = m.color;
      }
    }

    const id = makeId();
    groupsByDish.set(dish, {
      id,
      entry: {
        id,
        label: dish,
        icon: members[0].icon,
        grams,
        unit: 'g',
        amount: grams,
        color,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        sugar: 0,
        sodium: 0,
        cholesterol: 0,
        // A dish header measured nothing: its zeros are structural, and its
        // children carry the real micros. Never 'ai' — a group that claimed
        // provenance would be counted as a covered item it is not.
        microsSource: null,
        kind: 'group',
      },
    });
  }

  // Pass 2: emit in original order, inserting each group immediately before
  // its first member. `dish` is a parser-internal tag — never part of the
  // persisted FoodItem shape — so it is dropped from every output entry.
  const emittedDish = new Set();
  const result = [];
  for (const item of items) {
    const dish = item && item.dish;
    const { dish: _dish, ...rest } = item;

    if (!dish) {
      result.push({ ...rest, kind: 'item' });
      continue;
    }

    if (!emittedDish.has(dish)) {
      emittedDish.add(dish);
      result.push(groupsByDish.get(dish).entry);
    }
    result.push({ ...rest, kind: 'item', parentId: groupsByDish.get(dish).id });
  }

  return result;
}

export default groupParsedItems;
