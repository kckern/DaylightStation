/**
 * gradeTally — count a Polish run's per-measure grades and pick an overall read.
 * Shared by the silent-stop path, the completion path, and the RunSummary panel so
 * the number and the headline can never drift apart.
 *
 * Overall rule: greens win ties (an encouraging read), then reds over yellows (a
 * harsher read when greens don't lead).
 *
 * @param {Object<number,{grade?:'green'|'yellow'|'red'}>} grades
 * @returns {{ green:number, yellow:number, red:number, overall:'green'|'yellow'|'red' }}
 */
export function tallyGrades(grades) {
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const g of Object.values(grades || {})) {
    if (g?.grade && counts[g.grade] != null) counts[g.grade] += 1;
  }
  const overall = counts.green >= counts.yellow && counts.green >= counts.red
    ? 'green'
    : counts.red >= counts.yellow ? 'red' : 'yellow';
  return { ...counts, overall };
}

export default { tallyGrades };
