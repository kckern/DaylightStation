/**
 * MetricsService — Monthly Rollup Service
 *
 * Computes monthly rollups from daily lifelog data:
 * - Total minutes by category
 * - Value allocation for the month
 * - Highlights (top activities/achievements)
 * - Stores under rollups key in lifeplan-metrics.yml
 */
export class MetricsService {
  #aggregator;
  #metricsStore;
  #planStore;
  #clock;

  constructor({ aggregator, metricsStore, planStore, clock }) {
    this.#aggregator = aggregator;
    this.#metricsStore = metricsStore;
    this.#planStore = planStore;
    this.#clock = clock || { now: () => new Date() };
  }

  async computeMonthlyRollup(username, yearMonth) {
    const { startDate, endDate } = this.#monthRange(yearMonth);
    const rangeData = await this.#aggregator.aggregateRange(username, startDate, endDate);

    const categoryMinutes = {};
    const sourceMinutes = {};
    const dayCount = Object.keys(rangeData.days || {}).length;
    let activeDays = 0;

    for (const [, dayData] of Object.entries(rangeData.days || {})) {
      const daySources = dayData.sources || {};
      let dayHasActivity = false;

      for (const [source, data] of Object.entries(daySources)) {
        if (!data) continue;
        const minutes = this.#extractMinutes(source, data);
        if (minutes > 0) {
          sourceMinutes[source] = (sourceMinutes[source] || 0) + minutes;
          dayHasActivity = true;
        }
      }

      for (const [category, sources] of Object.entries(dayData.categories || {})) {
        for (const [, data] of Object.entries(sources)) {
          if (!data) continue;
          const minutes = this.#extractCategoryMinutes(data);
          if (minutes > 0) {
            categoryMinutes[category] = (categoryMinutes[category] || 0) + minutes;
          }
        }
      }

      if (dayHasActivity) activeDays++;
    }

    const highlights = this.#extractHighlights(rangeData);
    const valueAllocation = await this.#computeValueAllocation(username, categoryMinutes);

    const rollup = {
      month: yearMonth,
      startDate,
      endDate,
      dayCount,
      activeDays,
      categoryMinutes,
      sourceMinutes,
      highlights,
      valueAllocation,
      timestamp: this.#clock.now().toISOString(),
    };

    this.#metricsStore.saveSnapshot(username, {
      type: 'monthly_rollup',
      ...rollup,
    });

    return rollup;
  }

  getLatestRollup(username) {
    const history = this.#metricsStore.getHistory(username);
    const rollups = history.filter(s => s.type === 'monthly_rollup');
    return rollups.length > 0 ? rollups[rollups.length - 1] : null;
  }

  getRollupForMonth(username, yearMonth) {
    const history = this.#metricsStore.getHistory(username);
    return history.find(s => s.type === 'monthly_rollup' && s.month === yearMonth) || null;
  }

  #monthRange(yearMonth) {
    const [year, month] = yearMonth.split('-').map(Number);
    const startDate = `${yearMonth}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
    return { startDate, endDate };
  }

  #extractMinutes(source, data) {
    if (Array.isArray(data)) {
      return data.reduce((sum, item) => {
        if (item.duration != null) return sum + Number(item.duration);
        if (item.moving_time != null) return sum + Number(item.moving_time) / 60;
        return sum;
      }, 0);
    }
    if (data && typeof data === 'object') {
      if (data.duration != null) return Number(data.duration);
      if (data.total_minutes != null) return Number(data.total_minutes);
      if (data.activities && Array.isArray(data.activities)) {
        return data.activities.reduce((sum, a) => sum + (a.duration || 0), 0);
      }
    }
    return 0;
  }

  #extractCategoryMinutes(data) {
    return this.#extractMinutes(null, data);
  }

  #extractHighlights(rangeData) {
    const highlights = [];

    for (const [date, dayData] of Object.entries(rangeData.days || {})) {
      const strava = dayData.sources?.strava;
      if (Array.isArray(strava)) {
        for (const activity of strava) {
          if (activity.duration >= 60 || activity.sufferScore >= 100) {
            highlights.push({
              date,
              source: 'strava',
              text: `${activity.title || activity.type} — ${activity.duration}min`,
              metric: activity.duration,
            });
          }
        }
      }

      const calendar = dayData.sources?.calendar;
      if (Array.isArray(calendar)) {
        for (const event of calendar) {
          if (event.duration >= 4) {
            highlights.push({
              date,
              source: 'calendar',
              text: `${event.summary} — ${event.duration}h`,
              metric: event.duration * 60,
            });
          }
        }
      }
    }

    // Return top 10 by metric
    highlights.sort((a, b) => (b.metric || 0) - (a.metric || 0));
    return highlights.slice(0, 10);
  }

  async #computeValueAllocation(username, categoryMinutes) {
    let plan;
    try {
      plan = this.#planStore?.load?.(username);
    } catch { plan = null; }

    if (!plan?.values?.length) return {};

    const totalMinutes = Object.values(categoryMinutes).reduce((s, m) => s + m, 0);
    if (totalMinutes === 0) return {};

    // Map categories to values based on value definitions
    const allocation = {};
    for (const value of plan.values) {
      const categories = value.tracked_categories || [];
      let valueMinutes = 0;
      for (const cat of categories) {
        valueMinutes += categoryMinutes[cat] || 0;
      }
      allocation[value.id || value.name] = {
        minutes: valueMinutes,
        percentage: Math.round((valueMinutes / totalMinutes) * 100),
        rank: value.rank,
      };
    }

    return allocation;
  }
}
