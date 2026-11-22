/**
 * Summarize activity across the dates in a log view grouping.
 * Empty dates remain in the denominator so filtered views retain calendar coverage.
 */
export function summarizeActivityDays(daysByDate = {}) {
  const sources = new Set();
  let activeDayCount = 0;

  for (const day of Object.values(daysByDate)) {
    const daySources = Object.keys(day.sources || {});
    if (daySources.length > 0) activeDayCount += 1;
    daySources.forEach(source => sources.add(source));
  }

  const dayCount = Object.keys(daysByDate).length;
  return {
    dayCount,
    activeDayCount,
    distinctSourceCount: sources.size,
    coveragePercent: dayCount > 0 ? Math.round((activeDayCount / dayCount) * 100) : 0,
  };
}
