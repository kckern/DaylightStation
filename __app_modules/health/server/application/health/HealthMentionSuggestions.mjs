const ROLLING_LABELS = ['last_7d','last_30d','last_90d','last_180d','last_365d','last_2y','last_5y','last_10y','all_time','prev_7d','prev_30d','prev_90d','prev_180d','prev_365d'];
const CALENDAR_LABELS = ['this_week','this_month','this_quarter','this_year','last_quarter','last_year'];
const METRICS = ['weight_lbs','fat_percent','calories','protein_g','carbs_g','fat_g','fiber_g','workout_count','workout_duration_min','workout_calories','tracking_density'];

export class HealthMentionSuggestions {
  constructor({ analytics = null, healthData = null, aggregateHealth = null, now = () => new Date() }) {
    this.analytics = analytics; this.healthData = healthData; this.aggregateHealth = aggregateHealth; this.now = now;
  }
  async periods({ userId, prefix = '', limit = 50 }) {
    const out = [
      ...ROLLING_LABELS.map(slug => ({ slug, label: humanizeRolling(slug), value: { rolling: slug }, group: 'period' })),
      ...CALENDAR_LABELS.map(slug => ({ slug, label: humanizeCalendar(slug), value: { calendar: slug }, group: 'period' })),
    ];
    if (this.analytics?.listPeriods) {
      try {
        const result = await this.analytics.listPeriods({ userId });
        for (const period of result.periods || []) out.push({ slug: period.slug, label: period.label || period.slug, value: { named: period.slug }, group: 'period', subSource: period.source });
      } catch { /* named periods are optional */ }
    }
    return filter(out, prefix).slice(0, limit);
  }
  metrics({ prefix = '', limit = 50 }) {
    return filter(METRICS.map(slug => ({ slug, label: slug, value: { metric: slug }, group: 'metric' })), prefix).slice(0, limit);
  }
  async recentDays({ userId, prefix = '', has = null, days = 30, limit = 50 }) {
    const today = this.now();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const from = new Date(todayUtc); from.setUTCDate(from.getUTCDate() - (days - 1));
    const fromStr = from.toISOString().slice(0, 10); const toStr = todayUtc.toISOString().slice(0, 10);
    const [weight, nutrition, range] = await Promise.all([
      this.healthData?.loadWeightData?.(userId).catch(() => ({})) ?? Promise.resolve({}),
      this.healthData?.loadNutritionData?.(userId).catch(() => ({})) ?? Promise.resolve({}),
      this.aggregateHealth?.getHealthForRange?.(userId, fromStr, toStr).catch(() => ({})) ?? Promise.resolve({}),
    ]);
    const results = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(todayUtc); day.setUTCDate(todayUtc.getUTCDate() - i); const date = day.toISOString().slice(0, 10);
      const flags = { weight: !!weight?.[date], nutrition: !!nutrition?.[date] && (nutrition[date].calories ?? 0) > 0, workout: Array.isArray(range?.[date]?.workouts) && range[date].workouts.length > 0 };
      if (['weight', 'nutrition', 'workout'].includes(has) && !flags[has]) continue;
      results.push({ slug: date, label: date, value: { date }, group: 'day', has: flags });
    }
    return filter(results, prefix).slice(0, limit);
  }
  async all({ userId, prefix = '' }) {
    const buckets = await Promise.all([this.periods({ userId, prefix, limit: 8 }), this.recentDays({ userId, prefix, days: 14, limit: 14 }), Promise.resolve(this.metrics({ prefix, limit: 6 }))]);
    return roundRobin(buckets);
  }
}
const filter = (items, prefix) => prefix ? items.filter(item => item.slug.toLowerCase().includes(prefix) || (item.label || '').toLowerCase().includes(prefix)) : items;
function humanizeRolling(label) { if (label === 'all_time') return 'All time'; const m = /^(last|prev)_(\d+)([dy])$/.exec(label); if (!m) return label; const unit = m[3] === 'y' ? 'year' : 'day'; return `${m[1] === 'last' ? 'Last' : 'Previous'} ${m[2]} ${unit}${Number(m[2]) === 1 ? '' : 's'}`; }
const humanizeCalendar = label => label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
function roundRobin(buckets) { const out = []; for (let i = 0, any = true; any; i++) { any = false; for (const bucket of buckets) if (i < bucket.length) { out.push(bucket[i]); any = true; } } return out; }
