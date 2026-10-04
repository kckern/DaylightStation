/** Bar ranges use 0-based measure indices and include both endpoints. */
export function completeBarSelection(first, second) {
  if (!Number.isInteger(first) || !Number.isInteger(second) || first < 0 || second < 0) return null;
  return { inMeasure: Math.min(first, second), outMeasure: Math.max(first, second) };
}

export function moveBarEdge(range, edge, bar) {
  if (!range || !Number.isInteger(bar) || bar < 0) return range;
  if (edge === 'in') return { ...range, inMeasure: Math.min(bar, range.outMeasure) };
  if (edge === 'out') return { ...range, outMeasure: Math.max(bar, range.inMeasure) };
  return range;
}

export function validBarRange(range, measureCount) {
  return Number.isInteger(measureCount) && measureCount > 0
    && Number.isInteger(range?.inMeasure) && Number.isInteger(range?.outMeasure)
    && range.inMeasure >= 0 && range.inMeasure <= range.outMeasure && range.outMeasure < measureCount;
}
