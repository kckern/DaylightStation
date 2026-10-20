/** What grading added, rule by rule, from the week's price before and after. */
export function earnedLines(before, after) {
  if (!after) return null;
  const weekSilver = after.totals?.silver ?? 0;
  if (!before) return { lines: [], weekSilver };
  const was = new Map((before.lines ?? []).map((l) => [l.ruleId, l.amount ?? { silver: 0, gems: 0 }]));
  const lines = (after.lines ?? []).map((l) => {
    const prior = was.get(l.ruleId) ?? { silver: 0, gems: 0 };
    return { label: l.label, silver: Math.max(0, (l.amount?.silver ?? 0) - prior.silver), gems: Math.max(0, (l.amount?.gems ?? 0) - prior.gems) };
  }).filter((l) => l.silver > 0 || l.gems > 0);
  return { lines, weekSilver };
}
