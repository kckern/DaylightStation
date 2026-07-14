/**
 * worstSpan — from a Polish run's per-measure grades, find the heaviest contiguous
 * run of trouble measures (the natural thing to go drill). Non-green measures score
 * red = 2, yellow = 1; a run is a maximal block of adjacent measure INDICES that are
 * all non-green. Returns the highest-weight run's { inMeasure, outMeasure } (measure
 * indices), earlier run winning ties, or null when nothing is worth drilling.
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

export default { worstSpan };
