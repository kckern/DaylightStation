const KNOWN_METRICS = new Set([
  'weight_lbs', 'weight_kg', 'fat_pct', 'lean_mass_lbs',
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'tracking_density',
  'workout_count', 'workout_duration_min', 'workout_kcal',
  'hr_avg', 'hr_max', 'hr_minutes_zone2',
]);

export class HealthQueryService {
  #healthStore;
  #healthService;
  #now;

  constructor({ healthStore, healthService, now = () => new Date() }) {
    if (!healthStore) throw new Error('HealthQueryService: healthStore required');
    if (!healthService) throw new Error('HealthQueryService: healthService required');
    this.#healthStore = healthStore;
    this.#healthService = healthService;
    this.#now = now;
  }

  async query({ metric, period, granularity = 'daily', userId, ...rest }) {
    if (!KNOWN_METRICS.has(metric)) {
      throw new Error(`HealthQueryService: unknown metric "${metric}"`);
    }
    if (!userId) throw new Error('HealthQueryService: userId required');

    const { from, to } = this.#resolvePeriod(period);
    const series = await this.#fetchSeries(metric, userId, from, to);

    return {
      rows: series,
      meta: {
        metric,
        period,
        granularity,
        n: series.length,
        generated_at: this.#now().toISOString(),
      },
    };
  }

  #resolvePeriod(period) {
    if (period?.rolling) {
      const m = /^last_(\d+)d$/.exec(period.rolling);
      if (m) {
        const days = parseInt(m[1], 10);
        const today = this.#now();
        const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        const from = new Date(todayUtc);
        from.setUTCDate(from.getUTCDate() - (days - 1));
        return { from: from.toISOString().slice(0, 10), to: todayUtc.toISOString().slice(0, 10) };
      }
    }
    if (period?.from && period?.to) return { from: period.from, to: period.to };
    throw new Error(`HealthQueryService: unsupported period ${JSON.stringify(period)}`);
  }

  async #fetchSeries(metric, userId, from, to) {
    if (['weight_lbs', 'weight_kg', 'fat_pct', 'lean_mass_lbs'].includes(metric)) {
      const data = (await this.#healthStore.loadWeightData(userId)) ?? {};
      return Object.entries(data)
        .filter(([d]) => d >= from && d <= to)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, body]) => ({ date, value: this.#bodyMetric(body, metric) }));
    }
    if (['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'tracking_density'].includes(metric)) {
      const data = (await this.#healthStore.loadNutritionData(userId)) ?? {};
      return Object.entries(data)
        .filter(([d]) => d >= from && d <= to)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, n]) => ({ date, value: this.#nutritionMetric(n, metric) }));
    }
    if (['workout_count', 'workout_duration_min', 'workout_kcal', 'hr_avg', 'hr_max', 'hr_minutes_zone2'].includes(metric)) {
      const range = (await this.#healthService.getHealthForRange(userId, from, to)) ?? {};
      return Object.entries(range)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, day]) => ({ date, value: this.#workoutMetric(day?.workouts ?? [], metric) }));
    }
    return [];
  }

  #bodyMetric(body, metric) {
    switch (metric) {
      case 'weight_lbs': return body.lbs ?? null;
      case 'weight_kg':  return body.lbs ? body.lbs * 0.453592 : (body.kg ?? null);
      case 'fat_pct':    return body.fat_pct ?? null;
      case 'lean_mass_lbs': return body.lbs && body.fat_pct ? body.lbs * (1 - body.fat_pct / 100) : null;
      default: return null;
    }
  }

  #nutritionMetric(n, metric) {
    switch (metric) {
      case 'calories':         return n.calories ?? 0;
      case 'protein_g':        return n.protein ?? 0;
      case 'carbs_g':          return n.carbs ?? 0;
      case 'fat_g':            return n.fat ?? 0;
      case 'fiber_g':          return n.fiber ?? 0;
      case 'tracking_density': return n.tracking_density ?? null;
      default: return null;
    }
  }

  #workoutMetric(workouts, metric) {
    switch (metric) {
      case 'workout_count':        return workouts.length;
      case 'workout_duration_min': return workouts.reduce((s, w) => s + (w.duration ?? 0), 0);
      case 'workout_kcal':         return workouts.reduce((s, w) => s + (w.kcal ?? 0), 0);
      case 'hr_avg':               return workouts.length ? workouts.reduce((s, w) => s + (w.hr_avg ?? 0), 0) / workouts.length : null;
      case 'hr_max':               return workouts.reduce((m, w) => Math.max(m, w.hr_max ?? 0), 0);
      case 'hr_minutes_zone2':     return workouts.reduce((s, w) => s + (w.zone2_min ?? 0), 0);
      default: return null;
    }
  }
}

export default HealthQueryService;
