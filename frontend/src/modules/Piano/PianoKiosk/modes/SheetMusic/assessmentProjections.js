/** Sheet-Music-only projections over canonical per-span results. */
export function tallyAssessmentGrades(grades) {
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const grade of Object.values(grades || {})) if (grade?.grade in counts) counts[grade.grade] += 1;
  if (!Object.values(counts).some(Boolean)) return { ...counts, overall: null };
  const overall = counts.green >= counts.yellow && counts.green >= counts.red
    ? 'green'
    : counts.red >= counts.yellow ? 'red' : 'yellow';
  return { ...counts, overall };
}

export function findWorstAssessmentSpan(grades) {
  const weight = { red: 2, yellow: 1 };
  const indices = Object.keys(grades || {}).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  let best = null;
  let run = null;
  const close = () => {
    if (run && (!best || run.weight > best.weight)) best = run;
    run = null;
  };
  for (const index of indices) {
    const value = weight[grades[index]?.grade] || 0;
    if (!value) { close(); continue; }
    if (run && index === run.end + 1) { run.end = index; run.weight += value; }
    else { close(); run = { start: index, end: index, weight: value }; }
  }
  close();
  return best ? { inMeasure: best.start, outMeasure: best.end } : null;
}

export default { tallyAssessmentGrades, findWorstAssessmentSpan };
