// currentPeriodId.js — default-period resolution for PeriodSelect.jsx's
// callers, split out so Fast Refresh can hot-reload the select component on
// its own.

export function currentPeriodId(periods, now = Date.now()) {
  // NARROWEST current period (advocacy A5): in October, "close this period"
  // must mean Fall, not the whole school year that also contains now.
  const current = periods.filter((p) => Date.parse(p.startsAt) <= now && now < Date.parse(p.endsAt));
  if (current.length) {
    const hit = current.sort((a, b) => (
      (Date.parse(a.endsAt) - Date.parse(a.startsAt)) - (Date.parse(b.endsAt) - Date.parse(b.startsAt))
    ))[0];
    return hit.periodId;
  }
  // Between terms: the most recent period that has STARTED — a records view
  // should default to what just ended, never to a pre-configured future term.
  const started = periods
    .filter((p) => Date.parse(p.startsAt) <= now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return started.at(-1)?.periodId ?? periods[0]?.periodId ?? null;
}
