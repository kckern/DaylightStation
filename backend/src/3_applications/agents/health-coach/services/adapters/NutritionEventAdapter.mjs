// backend/src/3_applications/agents/health-coach/services/adapters/NutritionEventAdapter.mjs

import { EventAdapter } from '../EventAdapter.mjs';
import { resolvePeriod, toIso } from '../EventQueryService.mjs';
import { serializeNutriLog } from '#apps/nutrition/NutriLogProjection.mjs';
import { isCountedRow } from '#shared/contracts/nutrition/countedRows.mjs';
import { NUTRIENT_KEYS } from '#shared/contracts/health/foodQuantity.mjs';
import { isISODate } from '#shared/contracts/health/isoDate.mjs';

export class NutritionEventAdapter extends EventAdapter {
  #foodLogService;
  #userId;
  #now;
  #nutritionItems;

  constructor({ foodLogService, nutritionItems = null, userId, now = () => new Date() }) {
    super();
    if (!foodLogService && !nutritionItems) throw new Error('NutritionEventAdapter: nutrition source required');
    if (!userId) throw new Error('NutritionEventAdapter: userId required');
    this.#foodLogService = foodLogService;
    this.#userId = userId;
    this.#now = now;
    this.#nutritionItems = nutritionItems;
  }

  async #logsInRange(from, to) {
    if (!this.#nutritionItems) return this.#foodLogService.getLogsInRange(this.#userId, from, to);
    const rows = await this.#nutritionItems.findByDateRange(this.#userId, from, to);
    const meals = new Map();
    for (const row of rows.filter(isCountedRow)) {
      const date = row.date || row.createdAt?.slice(0, 10);
      const id = `ledger:${date}:${row.mealTime || 'unknown'}`;
      if (!meals.has(id)) meals.set(id, { id, meal: { date, time: row.mealTime || 'unknown' }, items: [], nutrition: {}, createdAt: row.createdAt });
      const meal = meals.get(id);
      meal.items.push({ ...row, name: row.name || row.item || row.label });
      for (const key of NUTRIENT_KEYS) meal.nutrition[key] = (meal.nutrition[key] || 0) + (Number(row[key]) || 0);
    }
    return [...meals.values()].sort((a, b) => b.meal.date.localeCompare(a.meal.date));
  }

  async list({ period, filter, limit }, { baseline = null } = {}) {  // eslint-disable-line no-unused-vars
    // baseline intentionally unused — per-meal vs daily-avg comparison isn't meaningful.
    // The second arg is accepted for API symmetry with FitnessEventAdapter / WeightEventAdapter.
    const { from, to } = resolvePeriod(period, this.#now);
    const logs = await this.#logsInRange(from, to);
    let events = (logs || []).map(l => this.#logToEvent(l));
    // Filter by meal time. The 'kind' and 'type' filters both target meal_time
    // here — this matches the EventAdapter contract while staying
    // domain-meaningful (morning/afternoon/evening/night).
    if (filter?.type) events = events.filter(e => e.domain_extras.meal_time === filter.type);
    if (filter?.kind) events = events.filter(e => e.domain_extras.meal_time === filter.kind);
    if (limit) events = events.slice(0, limit);
    return { events, meta: { kind: 'meal', period, n: events.length } };
  }

  async detail(id) {
    if (!id) throw new Error('NutritionEventAdapter: id required');
    let log;
    if (this.#nutritionItems) {
      const date = String(id).split(':')[1];
      if (!String(id).startsWith('ledger:') || !isISODate(date)) return { error: `meal not found for id=${id}` };
      log = (await this.#logsInRange(date, date)).find(meal => meal.id === id);
      if (!log) return { error: `meal not found for id=${id}` };
      return { ...this.#logToEvent(log), log_full: log, items_summary: { count: log.items.length, names: log.items.map(item => item.name) } };
    }
    try { log = await this.#foodLogService.getLogById(this.#userId, String(id)); }
    catch { return { error: `meal not found for id=${id}` }; }
    if (!log) return { error: `meal not found for id=${id}` };
    const base = this.#logToEvent(log);
    const items = log.items || [];
    return {
      ...base,
      log_full: serializeNutriLog(log),
      items_summary: {
        count: items.length,
        names: items.map(i => i?.name).filter(Boolean),
        top_kcal: [...items]
          .filter(i => i && typeof i.calories === 'number')
          .sort((a, b) => b.calories - a.calories)
          .slice(0, 3)
          .map(i => i.name),
      },
    };
  }

  async summary({ period }) {
    const { from, to } = resolvePeriod(period, this.#now);
    const logs = await this.#logsInRange(from, to);
    const dayKeys = new Set();
    let kcal_total = 0;
    let protein_total = 0;
    for (const l of logs) {
      const date = l.meal?.date ?? (toIso(l.createdAt) ?? '').slice(0, 10);
      if (date) dayKeys.add(date);
      kcal_total += l.nutrition?.calories ?? 0;
      protein_total += l.nutrition?.protein ?? 0;
    }
    const days = dayKeys.size || 1;
    return {
      kind: 'meal',
      period,
      n: logs.length,
      days,
      kcal_total,
      kcal_avg: Math.round(kcal_total / days),
      protein_g_avg: Math.round(protein_total / days),
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  #logToEvent(l) {
    const date = l.meal?.date ?? (toIso(l.createdAt) ?? '').slice(0, 10) ?? null;
    const iso = toIso(l.createdAt) ?? (date ? `${date}T00:00:00Z` : null);
    const kcal = l.nutrition?.calories ?? null;
    const meal_time = l.meal?.time ?? 'unknown';
    return {
      kind: 'meal',
      id: l.id?.toString?.() ?? String(l.id),
      timestamp: iso,
      date,
      label: `${meal_time}${kcal != null ? ` — ${kcal} kcal` : ''}`,
      scalars: {
        kcal,
        protein_g: l.nutrition?.protein ?? null,
        carbs_g: l.nutrition?.carbs ?? null,
        fat_g: l.nutrition?.fat ?? null,
        items_count: (l.items || []).length,
      },
      domain_extras: {
        meal_time,
        accepted: l.isAccepted ?? null,
      },
    };
  }
}

export default NutritionEventAdapter;
