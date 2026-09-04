//
// Geometry for the intake-vs-burn chart: per day, food hanging DOWN from a
// baseline and exercise standing UP from it.
//
// THE rule here is one shared scale. Both quantities are kcal, so giving each
// its own vertical scale would draw a 300 kcal walk the same height as a 2,400
// kcal day and make burn look like it cancels intake. Instead the baseline sits
// wherever the two maxima put it, and one kcal is the same number of pixels
// above the line as below it. A quiet exercise month therefore shows a thin
// strip of up-bars — which is the truth about it.
//
// Pure, and separate from the component, because jsdom cannot measure an SVG or
// a div: what a test can assert is the number the component sets.

/**
 * @param {Array} days - GET /budget/range entries (gaps included)
 * @returns {{
 *   scaleMaxKcal: number, foodAreaPct: number, exerciseAreaPct: number,
 *   bars: Array<{date: string, kind: 'gap'|'day', foodPct: number, exercisePct: number, food: number, exercise: number}>
 * }}
 *   `foodAreaPct` / `exerciseAreaPct` split the chart's height between the two
 *   halves in proportion to their maxima — which is exactly what makes one
 *   scale serve both. `foodPct` is then a percentage OF the food half, and
 *   likewise for exercise, so the component needs no arithmetic of its own.
 */
export function buildIntakeBurn(days) {
  const list = Array.isArray(days) ? days : [];
  const computed = list.filter((d) => d && !d.error);
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);

  const maxFood = computed.reduce((m, d) => Math.max(m, num(d.food)), 0);
  const maxExercise = computed.reduce((m, d) => Math.max(m, num(d.exercise)), 0);
  const total = maxFood + maxExercise;

  // Nothing logged at all: split the box evenly so the baseline is somewhere
  // sensible, and let every bar be zero. Never divide by zero.
  const foodAreaPct = total > 0 ? (maxFood / total) * 100 : 50;
  const exerciseAreaPct = 100 - foodAreaPct;

  const pctOf = (value, max) => (max > 0 ? (Math.min(num(value), max) / max) * 100 : 0);
  const round = (n) => Math.round(n * 10) / 10;

  return {
    scaleMaxKcal: total,
    foodAreaPct: round(foodAreaPct),
    exerciseAreaPct: round(exerciseAreaPct),
    bars: list.map((d) => (d?.error || !d ? { date: d?.date, kind: 'gap', foodPct: 0, exercisePct: 0, food: 0, exercise: 0 } : {
      date: d.date,
      kind: 'day',
      food: num(d.food),
      exercise: num(d.exercise),
      foodPct: round(pctOf(d.food, maxFood)),
      exercisePct: round(pctOf(d.exercise, maxExercise)),
    })),
  };
}
