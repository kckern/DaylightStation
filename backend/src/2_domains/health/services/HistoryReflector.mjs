// backend/src/2_domains/health/services/HistoryReflector.mjs

/**
 * Reflective composition over the analytical primitives. Surfaces a
 * multi-metric snapshot, candidate periods worth remembering, and
 * narrative observations from regime-change detection.
 *
 * @typedef {object} HistoryReflectorDeps
 * @property {object} aggregator    - MetricAggregator (for snapshot)
 * @property {object} trendAnalyzer - MetricTrendAnalyzer (for detectRegimeChange)
 * @property {object} periodMemory  - PeriodMemory (for deducePeriod)
 */
export class HistoryReflector {
  constructor(deps) {
    if (!deps?.aggregator)    throw new Error('HistoryReflector requires aggregator');
    if (!deps?.trendAnalyzer) throw new Error('HistoryReflector requires trendAnalyzer');
    if (!deps?.periodMemory)  throw new Error('HistoryReflector requires periodMemory');
    this.aggregator = deps.aggregator;
    this.trendAnalyzer = deps.trendAnalyzer;
    this.periodMemory = deps.periodMemory;
  }

  /**
   * Scan the user's full history and surface candidate periods + a
   * vital-signs snapshot + narrative observations.
   */
  async analyzeHistory({ userId, focus = null }) {
    const period = { rolling: 'all_time' };

    // 1) Snapshot: vital signs across all_time
    const summary = await this.aggregator.snapshot({ userId, period });

    // 2) Candidates: deduce_period across stock criteria
    const stock = stockCriteriaFor(focus);
    const candidateGroups = await Promise.all(
      stock.map(async (criteria) => {
        try {
          const r = await this.periodMemory.deducePeriod({ userId, criteria });
          return r.candidates || [];
        } catch {
          return [];
        }
      })
    );
    const candidates = candidateGroups.flat();

    // 3) Observations: regime changes in headline metrics
    const observationMetrics = focus === 'weight' ? ['weight_lbs'] :
                               focus === 'nutrition' ? ['calories', 'protein_g'] :
                               focus === 'training' ? ['workout_count'] :
                               ['weight_lbs', 'tracking_density'];

    const observations = [];
    for (const metric of observationMetrics) {
      try {
        const result = await this.trendAnalyzer.detectRegimeChange({
          userId, metric, period, max_results: 2,
        });
        for (const ch of (result.changes || [])) {
          const desc = ch.description ?? `regime change`;
          observations.push(`${metric} at ${ch.date}: ${desc}`);
        }
      } catch { /* best-effort */ }
    }

    return { summary, candidates, observations };
  }
}

export default HistoryReflector;

// ---------- helpers ----------

function stockCriteriaFor(focus) {
  const all = [
    { metric: 'weight_lbs',       value_range: [193, 197], min_duration_days: 30 },
    { metric: 'weight_lbs',       value_range: [188, 192], min_duration_days: 30 },
    { metric: 'tracking_density', field_above: 0.7,        min_duration_days: 60 },
    { metric: 'calories',         field_below: 1800,       min_duration_days: 21 },
  ];
  if (focus === 'weight') return all.filter(c => c.metric === 'weight_lbs');
  if (focus === 'nutrition') return all.filter(c => c.metric === 'calories' || c.metric === 'tracking_density');
  if (focus === 'training') return [];
  return all;
}
