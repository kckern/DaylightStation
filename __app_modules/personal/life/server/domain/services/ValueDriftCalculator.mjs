const BUILT_IN_DEFAULTS = {
  health: 'health',
  fitness: 'health',
  productivity: 'craft',
  social: 'family',
  finance: 'wealth',
  calendar: 'craft',
  journal: null,
};

const MINUTE_DEFAULTS = {
  strava: (item) => item.duration || 30,
  calendar: (item) => {
    if (item.endTime && item.time) {
      const start = new Date(item.time);
      const end = new Date(item.endTime);
      return Math.max(0, (end - start) / 60000);
    }
    return 60;
  },
  todoist: () => 15,
  clickup: () => 15,
  github: () => 30,
  lastfm: () => 3,
  checkins: () => 30,
};

export const MIN_COMMON_VALUES = 4;

export class ValueDriftCalculator {
  calculateAllocation(lifelogRange, valueMapping = {}, values = []) {
    const allocation = {};
    const categoryDefaults = valueMapping.category_defaults || {};
    const calendarRules = valueMapping.calendar_rules || [];
    const extractorOverrides = valueMapping.extractor_overrides || {};

    const days = lifelogRange.days || {};

    for (const [, dayData] of Object.entries(days)) {
      const sources = dayData.sources || {};

      for (const [source, items] of Object.entries(sources)) {
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          const valueId = this.#resolveValue(
            source, item, categoryDefaults, calendarRules, extractorOverrides
          );
          if (valueId === null) continue;

          const minutes = this.#estimateMinutes(source, item);
          allocation[valueId] = (allocation[valueId] || 0) + minutes;
        }
      }
    }

    // Normalize to proportions
    const total = Object.values(allocation).reduce((s, v) => s + v, 0);
    if (total === 0) return {};

    const result = {};
    for (const [id, mins] of Object.entries(allocation)) {
      result[id] = mins / total;
    }
    return result;
  }

  calculateDrift(allocation, values) {
    if (values.length === 0 || Object.keys(allocation).length === 0) {
      return {
        correlation: null,
        status: 'insufficient_data',
        statedOrder: [],
        observedOrder: [],
        statedRankById: {},
        observedRankById: {},
        statedTieCountById: {},
        observedTieCountById: {},
        allocation,
      };
    }

    const statedRanking = this.#rankValues(values.map(value => [value.id, value.rank ?? 999]));
    const statedOrder = [...values]
      .sort((a, b) => statedRanking.rankById[a.id] - statedRanking.rankById[b.id] || a.id.localeCompare(b.id))
      .map(value => value.id);

    const observedEntries = Object.entries(allocation);
    const observedRanking = this.#rankValues(observedEntries, 'descending');
    const observedOrder = observedEntries
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id]) => id);

    const common = statedOrder.filter((id) => observedOrder.includes(id));
    const rankData = {
      statedOrder,
      observedOrder,
      statedRankById: statedRanking.rankById,
      observedRankById: observedRanking.rankById,
      statedTieCountById: statedRanking.tieCountById,
      observedTieCountById: observedRanking.tieCountById,
      allocation,
    };
    if (common.length < MIN_COMMON_VALUES) {
      return { correlation: null, status: 'insufficient_data', ...rankData };
    }

    const commonIds = new Set(common);
    const statedCommonRanking = this.#rankValues(
      values.filter(value => commonIds.has(value.id)).map(value => [value.id, value.rank ?? 999])
    );
    const observedCommonRanking = this.#rankValues(
      observedEntries.filter(([id]) => commonIds.has(id)),
      'descending'
    );
    const statedRanks = common.map(id => statedCommonRanking.rankById[id]);
    const observedRanks = common.map(id => observedCommonRanking.rankById[id]);
    const correlation = this.#spearmanCorrelation(statedRanks, observedRanks);

    // A too-small overlap or a tied ranking with zero variance means there is no
    // meaningful correlation to report — not a genuine bad correlation.
    if (correlation === null) {
      return { correlation: null, status: 'insufficient_data', ...rankData };
    }

    const status = correlation > 0.8 ? 'aligned'
      : correlation > 0.5 ? 'drifting'
      : 'reconsidering';

    return { correlation, status, ...rankData };
  }

  #resolveValue(source, item, categoryDefaults, calendarRules, extractorOverrides) {
    // 1. Extractor overrides (highest priority)
    if (source in extractorOverrides) {
      return extractorOverrides[source];
    }

    // 2. Calendar rules
    if (source === 'calendar' || item.category === 'calendar') {
      for (const rule of calendarRules) {
        if (this.#matchCalendarRule(rule.match, item)) {
          return rule.value;
        }
      }
      const defaultRule = calendarRules.find(r => r.default);
      if (defaultRule) return defaultRule.default;
    }

    // 3. Category defaults (user-defined)
    const category = item.category || source;
    if (category in categoryDefaults) {
      return categoryDefaults[category];
    }

    // 4. Built-in defaults
    return BUILT_IN_DEFAULTS[category] ?? BUILT_IN_DEFAULTS[source] ?? null;
  }

  #matchCalendarRule(match, item) {
    if (!match) return false;
    if (match.calendarName && item.calendarName === match.calendarName) return true;
    if (match.summary_contains && item.summary?.toLowerCase().includes(match.summary_contains.toLowerCase())) return true;
    return false;
  }

  #estimateMinutes(source, item) {
    const estimator = MINUTE_DEFAULTS[source];
    if (estimator) return estimator(item);
    return 15; // default fallback
  }

  #rankValues(entries, direction = 'ascending') {
    const sorted = entries
      .map(([id, score]) => ({ id, score: Number(score) }))
      .sort((a, b) => (direction === 'descending' ? b.score - a.score : a.score - b.score) || a.id.localeCompare(b.id));
    const rankById = {};
    const tieCountById = {};

    for (let start = 0; start < sorted.length;) {
      let end = start + 1;
      while (end < sorted.length && sorted[end].score === sorted[start].score) end += 1;
      const rank = ((start + 1) + end) / 2;
      const tieCount = end - start;
      for (let index = start; index < end; index += 1) {
        rankById[sorted[index].id] = rank;
        tieCountById[sorted[index].id] = tieCount;
      }
      start = end;
    }

    return { rankById, tieCountById };
  }

  #spearmanCorrelation(stated, observed) {
    // Spearman is Pearson correlation over average ranks, including tied values.
    if (stated.length < 2) return null; // undefined over <2 pairs — caller maps to insufficient_data

    const n = stated.length;
    const meanStated = stated.reduce((sum, rank) => sum + rank, 0) / n;
    const meanObserved = observed.reduce((sum, rank) => sum + rank, 0) / n;
    let covariance = 0;
    let statedVariance = 0;
    let observedVariance = 0;

    for (let index = 0; index < n; index += 1) {
      const statedDelta = stated[index] - meanStated;
      const observedDelta = observed[index] - meanObserved;
      covariance += statedDelta * observedDelta;
      statedVariance += statedDelta * statedDelta;
      observedVariance += observedDelta * observedDelta;
    }

    if (statedVariance === 0 || observedVariance === 0) return null;
    return Math.max(-1, Math.min(1, covariance / Math.sqrt(statedVariance * observedVariance)));
  }
}
