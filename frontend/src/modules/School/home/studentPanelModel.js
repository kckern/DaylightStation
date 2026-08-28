// studentPanelModel.js — pure derivation logic for StudentPanel.jsx, split
// out so Fast Refresh can hot-reload the panel component on its own.

/** Pure model: which report leads, today's metric, the done flip, last activity. */
export function derivePanelModel(reports) {
  const list = reports ?? [];
  const actionable = list.filter((r) => r.next && r.state !== 'satisfied' && r.state !== 'complete');
  const primary = actionable[0] ?? null;
  const today = primary?.metrics?.find((m) => m.kind === 'progress' && m.scope === 'today') ?? null;
  const allDone = actionable.length === 0 && list.length > 0;
  const lastActivity = list.reduce(
    (max, r) => (r.lastActivity && (!max || r.lastActivity > max) ? r.lastActivity : max),
    null,
  );
  return { primary, today, allDone, lastActivity };
}

/**
 * Pure model: the most recently touched results lane, as an accuracy percent.
 * Results are per-bank lifetime aggregates (spec §5 keeps quiz and flashcard
 * lanes separate), so this is "how you're doing on the thing you last did",
 * not a single attempt's score.
 */
export function deriveLatestScore(results, bankTitles) {
  let best = null;
  for (const r of results ?? []) {
    for (const lane of ['quiz', 'flashcard']) {
      const l = r[lane];
      if (l?.lastAt && l.attempts > 0 && (!best || l.lastAt > best.lastAt)) {
        best = { lastAt: l.lastAt, pct: Math.round((l.correct / l.attempts) * 100), bankId: r.bankId };
      }
    }
  }
  if (!best) return null;
  return { label: bankTitles?.get(best.bankId) ?? best.bankId, pct: best.pct };
}
