// backend/src/3_applications/agents/health-coach/services/adapters/WeightEventAdapter.mjs

import { EventAdapter } from '../EventAdapter.mjs';
import { resolvePeriod } from '../EventQueryService.mjs';

export class WeightEventAdapter extends EventAdapter {
  #healthService;
  #userId;
  #now;

  constructor({ healthService, userId, now = () => new Date() }) {
    super();
    if (!healthService) throw new Error('WeightEventAdapter: healthService required');
    if (!userId) throw new Error('WeightEventAdapter: userId required');
    this.#healthService = healthService;
    this.#userId = userId;
    this.#now = now;
  }

  async list({ period, filter, limit }) {
    const { from, to } = resolvePeriod(period, this.#now);
    const rangeMap = await this.#healthService.getHealthForRange(this.#userId, from, to).catch(() => ({}));
    const points = this.#mapToPoints(rangeMap);
    let events = points
      .map(p => this.#pointToEvent(p))
      .sort((a, b) => b.date.localeCompare(a.date));  // newest first
    if (limit) events = events.slice(0, limit);
    return { events, meta: { kind: 'weigh_in', period, n: events.length } };
  }

  async detail(id) {
    if (!id) throw new Error('WeightEventAdapter: id required');
    const date = String(id).slice(0, 10);
    const target = new Date(date + 'T00:00:00Z');
    const fromDate = new Date(target);
    fromDate.setUTCDate(fromDate.getUTCDate() - 4);
    const toDate = new Date(target);
    const rangeMap = await this.#healthService.getHealthForRange(
      this.#userId,
      fromDate.toISOString().slice(0, 10),
      toDate.toISOString().slice(0, 10),
    ).catch(() => ({}));
    const points = this.#mapToPoints(rangeMap);
    const focal = points.find(p => p.date === date);
    if (!focal) return { error: `weigh-in not found for date=${date}` };
    return {
      ...this.#pointToEvent(focal),
      context_window: points
        .map(p => this.#pointToEvent(p))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async summary({ period }) {
    const { from, to } = resolvePeriod(period, this.#now);
    const rangeMap = await this.#healthService.getHealthForRange(this.#userId, from, to).catch(() => ({}));
    const points = this.#mapToPoints(rangeMap);
    if (points.length === 0) {
      return { kind: 'weigh_in', period, n: 0, trim_mean: null, slope_lbs_per_30d: null };
    }
    const xs = points
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(p => p.lbs);
    const sorted = [...xs].sort((a, b) => a - b);
    const trimN = Math.floor(sorted.length * 0.1);
    const trimmed = sorted.slice(trimN, sorted.length - trimN || sorted.length);
    const trim_mean = trimmed.reduce((a, b) => a + b, 0) / (trimmed.length || 1);
    let slope = 0;
    if (xs.length >= 2) {
      const xMean = (xs.length - 1) / 2;
      const yMean = xs.reduce((a, b) => a + b, 0) / xs.length;
      let num = 0, den = 0;
      for (let i = 0; i < xs.length; i++) {
        num += (i - xMean) * (xs[i] - yMean);
        den += (i - xMean) * (i - xMean);
      }
      slope = den > 0 ? num / den : 0;
    }
    return {
      kind: 'weigh_in', period, n: xs.length,
      trim_mean: Math.round(trim_mean * 10) / 10,
      slope_lbs_per_30d: Math.round(slope * 30 * 100) / 100,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  #mapToPoints(rangeMap) {
    const out = [];
    for (const [date, metric] of Object.entries(rangeMap || {})) {
      const w = metric?.weight;
      if (w && w.lbs != null && Number.isFinite(w.lbs)) {
        out.push({
          date,
          lbs: w.lbs,
          fat_percent: w.fatPercent ?? null,
          lean_lbs: w.leanLbs ?? null,
          trend: w.trend ?? null,
        });
      }
    }
    return out;
  }

  #pointToEvent(p) {
    return {
      kind: 'weigh_in',
      id: p.date,
      timestamp: p.date + 'T00:00:00Z',
      date: p.date,
      label: `${p.lbs} lbs`,
      scalars: {
        weight_lbs: p.lbs,
        fat_percent: p.fat_percent ?? null,
        lean_lbs: p.lean_lbs ?? null,
      },
      domain_extras: {
        trend_lbs: p.trend ?? null,
      },
    };
  }
}

export default WeightEventAdapter;
