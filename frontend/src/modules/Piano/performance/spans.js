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

/**
 * worstSpan — from a Polish run's per-measure grades, find the heaviest contiguous
 * run of trouble measures (the natural thing to go drill). Non-green measures score
 * red = 2, yellow = 1; a run is a maximal block of adjacent measure INDICES that are
 * all non-green. Returns the highest-weight run's { inMeasure, outMeasure } (measure
 * indices), earlier run winning ties, or null when nothing is worth drilling.
 * Span indices are measures in polish and transposition cells in drills.
 *
 * @param {Object<number,{grade?:'green'|'yellow'|'red'}>} grades
 * @returns {{ inMeasure:number, outMeasure:number } | null}
 */
const WEIGHT = { red: 2, yellow: 1 };

export function worstSpan(grades) {
  const indices = Object.keys(grades || {})
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);

  let best = null;      // { start, end, weight }
  let run = null;       // current run being extended

  const close = () => {
    if (run && (!best || run.weight > best.weight)) best = run;
    run = null;
  };

  for (const idx of indices) {
    const grade = grades[idx]?.grade;
    const w = WEIGHT[grade] || 0;
    if (w === 0) { close(); continue; } // green / ungraded → break the run
    if (run && idx === run.end + 1) {
      run.end = idx;
      run.weight += w; // extend the adjacent run
    } else {
      close();
      run = { start: idx, end: idx, weight: w };
    }
  }
  close();

  return best ? { inMeasure: best.start, outMeasure: best.end } : null;
}

export default { tallyGrades, worstSpan };
