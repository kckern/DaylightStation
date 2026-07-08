/**
 * Fold small items into a synthetic "Other" bucket. The ONE implementation
 * of this rule — the treemap and the spending drilldown previously each
 * hand-rolled their own with different magic numbers (audit 4.2).
 *
 * Items need a numeric `value`. Two folding modes (combinable with maxItems):
 *  - cumulativeShare: keep items (sorted desc) while the kept total is
 *    below that share of the grand total; fold the tail.
 *  - minShare: fold every item whose value is below that share of total.
 *  - maxItems: after the above, cap the kept list, folding the excess.
 *
 * Returns { kept, other } where other is { value, items } or null.
 */
export function groupSmall(items, { cumulativeShare, minShare, maxItems } = {}) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return { kept: [], other: null };

  let kept = [];
  let folded = [];

  if (cumulativeShare != null) {
    let acc = 0;
    for (const item of sorted) {
      if (acc / total < cumulativeShare) {
        kept.push(item);
        acc += item.value;
      } else {
        folded.push(item);
      }
    }
  } else if (minShare != null) {
    kept = sorted.filter((i) => i.value / total >= minShare);
    folded = sorted.filter((i) => i.value / total < minShare);
  } else {
    kept = sorted;
  }

  if (maxItems != null && kept.length > maxItems) {
    folded = [...kept.slice(maxItems), ...folded];
    kept = kept.slice(0, maxItems);
  }

  const otherValue = folded.reduce((s, i) => s + i.value, 0);
  return { kept, other: otherValue > 0 ? { value: otherValue, items: folded } : null };
}
