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
      return { correlation: 0, status: 'reconsidering', statedOrder: [], observedOrder: [] };
    }

    const statedOrder = values
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
      .map(v => v.id);

    const observedOrder = Object.entries(allocation)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    const correlation = this.#spearmanCorrelation(statedOrder, observedOrder);

    const status = correlation > 0.8 ? 'aligned'
      : correlation > 0.5 ? 'drifting'
      : 'reconsidering';

    return { correlation, status, statedOrder, observedOrder, allocation };
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

  #spearmanCorrelation(stated, observed) {
    // Use only items present in both lists
    const common = stated.filter(id => observed.includes(id));
    if (common.length < 2) return 0;

    const n = common.length;
    let sumD2 = 0;

    for (const id of common) {
      const statedRank = stated.indexOf(id) + 1;
      const observedRank = observed.indexOf(id) + 1;
      const d = statedRank - observedRank;
      sumD2 += d * d;
    }

    return 1 - (6 * sumD2) / (n * (n * n - 1));
  }
}
