/**
 * gradeTally — count a Polish run's per-measure grades and pick an overall read.
 * Shared by the silent-stop path, the completion path, and the RunSummary panel so
 * the number and the headline can never drift apart.
 *
 * Overall rule: greens win ties (an encouraging read), then reds over yellows (a
 * harsher read when greens don't lead). An EMPTY tally has no overall at all —
 * `overall` is null. Nothing graded is not a good run: the greens-win-ties rule
 * used to score zero-of-everything as 'green', so a run in which the user never
 * played a measure read back as a success. Callers must render/log null as its
 * own "nothing to report" state, never as a grade.
 *
 * @param {Object<number,{grade?:'green'|'yellow'|'red'}>} grades
 * @returns {{ green:number, yellow:number, red:number, overall:'green'|'yellow'|'red'|null }}
 */
export function tallyGrades(grades) {
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const g of Object.values(grades || {})) {
    if (g?.grade && counts[g.grade] != null) counts[g.grade] += 1;
  }
  if (counts.green + counts.yellow + counts.red === 0) return { ...counts, overall: null };
  const overall = counts.green >= counts.yellow && counts.green >= counts.red
    ? 'green'
    : counts.red >= counts.yellow ? 'red' : 'yellow';
  return { ...counts, overall };
}

export default { tallyGrades };
