/** Map a language corpus and study day to School's curriculum taxonomy. */
export function taxonomyFor({ corpus, day, unitSize = 10 }) {
  const safeDay = Number.isInteger(day) && day >= 1 ? day : 1;
  const safeUnitSize = Number.isInteger(unitSize) && unitSize >= 1 ? unitSize : 10;
  const label = corpus?.label ?? corpus?.id ?? 'Language study';
  return {
    subject: 'language',
    course: String(label),
    unit: `Unit ${Math.ceil(safeDay / safeUnitSize)}`,
    lesson: `Day ${safeDay}`,
  };
}
