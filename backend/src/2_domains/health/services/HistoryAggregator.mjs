/**
 * HistoryAggregator - Pure domain service for rolling up daily health data
 * into weekly and monthly aggregates.
 *
 * No I/O, no dependencies. Takes an array of daily entries, returns tiered buckets.
 */

function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function avg(values) {
  const valid = values.filter(v => v != null && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function sum(values) {
  return values.reduce((a, b) => a + (b || 0), 0);
}

function aggregateBucket(period, entries) {
  if (!entries.length) return null;
  const dates = entries.map(e => e.date).sort();
  return {
    period,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    days: entries.length,
    weight: avg(entries.map(e => e.weight?.lbs)),
    nutrition: {
      calories: avg(entries.map(e => e.nutrition?.calories)),
    },
    workouts: {
      count: sum(entries.map(e => e.workouts?.length || 0)),
      totalMinutes: sum(entries.map(e =>
        (e.workouts || []).reduce((t, w) => t + (w.duration || 0), 0)
      )),
      totalCalories: sum(entries.map(e =>
        (e.workouts || []).reduce((t, w) => t + (w.calories || 0), 0)
      )),
    },
    sessions: {
      count: sum(entries.map(e => e.sessions?.length || 0)),
      totalCoins: sum(entries.map(e =>
        (e.sessions || []).reduce((t, s) => t + (s.totalCoins || 0), 0)
      )),
    },
  };
}

export function rollUpHistory(dailyEntries, options = {}) {
  const dailyCutoff = options.dailyCutoff ?? 90;
  const weeklyCutoff = options.weeklyCutoff ?? 180;
  const monthlyCutoff = options.monthlyCutoff ?? 730;

  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const daily = [];
  const weeklyBuckets = new Map();
  const monthlyBuckets = new Map();

  for (const entry of dailyEntries) {
    if (!entry?.date) continue;
    const daysAgo = Math.floor((new Date(today + 'T12:00:00Z') - new Date(entry.date + 'T12:00:00Z')) / 86400000);

    if (daysAgo < 0) continue;
    if (daysAgo <= dailyCutoff) {
      daily.push(entry);
    } else if (daysAgo <= weeklyCutoff) {
      const wk = isoWeek(entry.date);
      if (!weeklyBuckets.has(wk)) weeklyBuckets.set(wk, []);
      weeklyBuckets.get(wk).push(entry);
    } else if (daysAgo <= monthlyCutoff) {
      const mk = monthKey(entry.date);
      if (!monthlyBuckets.has(mk)) monthlyBuckets.set(mk, []);
      monthlyBuckets.get(mk).push(entry);
    }
  }

  const weekly = [];
  for (const [period, entries] of weeklyBuckets) {
    const agg = aggregateBucket(period, entries);
    if (agg) weekly.push(agg);
  }
  weekly.sort((a, b) => b.startDate.localeCompare(a.startDate));

  const monthly = [];
  for (const [period, entries] of monthlyBuckets) {
    const agg = aggregateBucket(period, entries);
    if (agg) monthly.push(agg);
  }
  monthly.sort((a, b) => b.startDate.localeCompare(a.startDate));

  return { daily, weekly, monthly };
}

export default { rollUpHistory };
