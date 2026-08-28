// curriculumPassSummary.js — the pass-bar summary line for
// CurriculumCatalog.jsx's course cards, split out so Fast Refresh can
// hot-reload the panel component on its own.

// The card's one-line pass summary: the most common effective percent, plus
// how many lessons deviate from it.
export function passSummary(units, overrideMap) {
  const effective = units
    .map((unit) => overrideMap[unit.unitId] ?? unit.passingPercent)
    .filter((value) => value != null);
  if (!effective.length) return 'no pass bar';
  const counts = new Map();
  for (const value of effective) counts.set(value, (counts.get(value) ?? 0) + 1);
  const [modal] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const overrides = units.filter((unit) => overrideMap[unit.unitId] != null).length;
  return `pass ${modal}%${overrides ? ` · ${overrides} override${overrides === 1 ? '' : 's'}` : ''}`;
}
