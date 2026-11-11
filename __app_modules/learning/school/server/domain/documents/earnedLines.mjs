/**
 * What grading added, rule by rule, from the week's price before and after.
 * Only `earned` amounts count, on both sides: a pending line (a contest still
 * being decided, a week still under way) carries an amount nobody has been
 * paid, and paper shows payouts, not promises. `weekSilver` is the preview's
 * `totals`, which already sums earned lines only.
 */
const ZERO = { silver: 0, gems: 0 };
const earnedAmount = (line) => (line?.status === 'earned' ? (line.amount ?? ZERO) : ZERO);

export function earnedLines(before, after) {
  if (!after) return null;
  const weekSilver = after.totals?.silver ?? 0;
  if (!before) return { lines: [], weekSilver };
  const was = new Map((before.lines ?? []).map((l) => [l.ruleId, earnedAmount(l)]));
  const lines = (after.lines ?? []).map((l) => {
    const now = earnedAmount(l);
    const prior = was.get(l.ruleId) ?? ZERO;
    return {
      label: l.label,
      silver: Math.max(0, (now.silver ?? 0) - (prior.silver ?? 0)),
      gems: Math.max(0, (now.gems ?? 0) - (prior.gems ?? 0)),
    };
  }).filter((l) => l.silver > 0 || l.gems > 0);
  return { lines, weekSilver };
}
