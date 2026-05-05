// backend/src/2_domains/health/services/PeriodMemory.mjs

const AGENT_ID = 'health-coach';
const PERIOD_REMEMBERED_PREFIX = 'period.remembered.';
const PERIOD_DEDUCED_PREFIX    = 'period.deduced.';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_DEDUCED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Period memory — list / deduce / remember / forget.
 *
 * Stores periods under namespaced keys in agent working memory:
 *   period.remembered.<slug> — promoted by the agent, persistent
 *   period.deduced.<slug>    — auto-cached from deduce_period(), TTL 30d
 *
 * Reads declared periods from playbook.named_periods.
 *
 * @typedef {object} PeriodMemoryDeps
 * @property {object} workingMemoryAdapter - IWorkingMemory implementation
 * @property {object} [playbookLoader]     - { loadPlaybook(userId) }
 * @property {object} [trendAnalyzer]      - { detectSustained(args) } for deduce
 * @property {number} [deducedTtlMs]
 */
export class PeriodMemory {
  constructor(deps) {
    if (!deps?.workingMemoryAdapter) throw new Error('PeriodMemory requires workingMemoryAdapter');
    this.adapter = deps.workingMemoryAdapter;
    this.playbookLoader = deps.playbookLoader ?? null;
    this.trendAnalyzer = deps.trendAnalyzer ?? null;
    this.deducedTtlMs = deps.deducedTtlMs ?? DEFAULT_DEDUCED_TTL_MS;
  }

  async listPeriods({ userId }) {
    const periods = [];

    // Working memory: remembered + deduced
    const state = await this.adapter.load(AGENT_ID, userId);
    const all = (typeof state?.getAll === 'function') ? state.getAll() : {};
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(PERIOD_REMEMBERED_PREFIX)) {
        const slug = key.slice(PERIOD_REMEMBERED_PREFIX.length);
        periods.push(makeListEntry(slug, value, 'remembered'));
      } else if (key.startsWith(PERIOD_DEDUCED_PREFIX)) {
        const slug = key.slice(PERIOD_DEDUCED_PREFIX.length);
        periods.push(makeListEntry(slug, value, 'deduced'));
      }
    }

    // Playbook: declared
    if (this.playbookLoader) {
      const playbook = await this.playbookLoader.loadPlaybook(userId);
      const named = playbook?.named_periods ?? {};
      for (const [slug, raw] of Object.entries(named)) {
        periods.push({
          slug,
          label: slug,
          from: formatYmd(raw.from),
          to: formatYmd(raw.to),
          source: 'declared',
          description: raw.description ?? null,
        });
      }
    }

    // Sort by slug for stable output
    periods.sort((a, b) => a.slug.localeCompare(b.slug));

    return { periods };
  }

  async rememberPeriod({ userId, slug, from, to, label, description = null }) {
    if (!SLUG_RE.test(slug)) {
      throw new Error(`PeriodMemory: invalid slug "${slug}" (must match ${SLUG_RE})`);
    }
    if (!from || !to) throw new Error('PeriodMemory: from and to are required');
    if (!label) throw new Error('PeriodMemory: label is required');

    const state = await this.adapter.load(AGENT_ID, userId);
    const entry = { from, to, label, description, promotedAt: new Date().toISOString() };
    state.set(`${PERIOD_REMEMBERED_PREFIX}${slug}`, entry);  // no TTL
    await this.adapter.save(AGENT_ID, userId, state);
    return { slug, ...entry };
  }

  async forgetPeriod({ userId, slug }) {
    const state = await this.adapter.load(AGENT_ID, userId);
    state.remove(`${PERIOD_REMEMBERED_PREFIX}${slug}`);
    await this.adapter.save(AGENT_ID, userId, state);
    return { slug, removed: true };
  }

  async deducePeriod({ userId, criteria, max_results = 3 }) {
    if (!this.trendAnalyzer) {
      throw new Error('PeriodMemory.deducePeriod requires trendAnalyzer dep (provides detectSustained)');
    }
    if (!criteria?.metric) throw new Error('PeriodMemory.deducePeriod: criteria.metric is required');
    if (!Number.isFinite(criteria.min_duration_days)) {
      throw new Error('PeriodMemory.deducePeriod: criteria.min_duration_days is required');
    }

    // Map criteria to detectSustained's condition vocabulary.
    let condition;
    if (Array.isArray(criteria.value_range) && criteria.value_range.length === 2) {
      condition = { value_range: criteria.value_range };
    } else if (typeof criteria.field_above === 'number') {
      condition = { field_above: criteria.field_above };
    } else if (typeof criteria.field_below === 'number') {
      condition = { field_below: criteria.field_below };
    } else {
      throw new Error('PeriodMemory.deducePeriod: criteria must include value_range, field_above, or field_below');
    }

    const result = await this.trendAnalyzer.detectSustained({
      userId,
      metric: criteria.metric,
      period: criteria.period ?? { rolling: 'all_time' },
      condition,
      min_duration_days: criteria.min_duration_days,
    });

    const candidates = (result.runs || [])
      .map((run, idx) => ({
        slug: makeAutoSlug(criteria, run, idx),
        from: run.from, to: run.to,
        durationDays: run.durationDays,
        label: makeAutoLabel(criteria, run),
        stats: run.summary,
        score: run.durationDays,  // simple score; longer runs rank higher
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, max_results);

    // Cache each candidate under period.deduced.<slug> with TTL.
    if (candidates.length) {
      const state = await this.adapter.load(AGENT_ID, userId);
      for (const c of candidates) {
        state.set(`${PERIOD_DEDUCED_PREFIX}${c.slug}`,
          { from: c.from, to: c.to, label: c.label, criteria, score: c.score },
          { ttl: this.deducedTtlMs });
      }
      await this.adapter.save(AGENT_ID, userId, state);
    }

    return { criteria, candidates };
  }
}

export default PeriodMemory;

// ---------- helpers ----------

function makeListEntry(slug, value, source) {
  return {
    slug, label: value?.label ?? slug,
    from: value?.from, to: value?.to,
    source,
    description: value?.description ?? null,
  };
}

function makeAutoSlug(criteria, run, idx) {
  const base = criteria.metric.replace(/_/g, '-');
  const yr = run.from.slice(0, 4);
  return `${base}-${yr}-${idx + 1}`;
}

function makeAutoLabel(criteria, run) {
  const metric = criteria.metric;
  if (Array.isArray(criteria.value_range)) {
    return `${metric} in [${criteria.value_range[0]}, ${criteria.value_range[1]}] (${run.from} → ${run.to})`;
  }
  if ('field_above' in criteria) return `${metric} > ${criteria.field_above} (${run.from} → ${run.to})`;
  if ('field_below' in criteria) return `${metric} < ${criteria.field_below} (${run.from} → ${run.to})`;
  return `${metric} (${run.from} → ${run.to})`;
}

function formatYmd(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}
