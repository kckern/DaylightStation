// A per-day census of rows that will render as gaps: no artwork, unknown
// calories ("— kcal"), no gram mass (the density badge shows "—"), shouting
// all-caps label names, and the same food logged repeatedly in one meal (a
// scanner re-fire). Pure, so the counting is testable apart from the logging.

const MAX_SAMPLES = 5;
const isAllCaps = name => /[A-Z]{3}/.test(name) && name === name.toUpperCase();

export function summarizeDayQuality(items = []) {
  const foods = items.filter(row => row.kind !== 'group');
  const name = row => row.item || row.name || row.label || '';
  const pick = rows => ({ count: rows.length, samples: [...new Set(rows.map(name))].slice(0, MAX_SAMPLES) });
  const repeats = new Map();
  for (const row of foods) {
    const key = `${row.mealTime}|${name(row)}`;
    repeats.set(key, (repeats.get(key) || 0) + 1);
  }
  const duplicates = [...repeats].filter(([, n]) => n > 1).map(([key, n]) => `${key.split('|')[1]} ×${n}`);
  const summary = {
    rows: foods.length,
    noArtwork: pick(foods.filter(row => !row.photoRef && (!row.icon || row.icon === 'default'))),
    unknownCalories: pick(foods.filter(row => row.calories == null)),
    noGrams: pick(foods.filter(row => !(Number(row.grams) > 0))),
    allCaps: pick(foods.filter(row => isAllCaps(name(row)))),
    duplicates: { count: duplicates.length, samples: duplicates.slice(0, MAX_SAMPLES) },
  };
  summary.issues = ['noArtwork', 'unknownCalories', 'noGrams', 'allCaps', 'duplicates']
    .reduce((sum, key) => sum + summary[key].count, 0);
  return summary;
}
