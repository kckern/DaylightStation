// backend/src/4_api/v1/routers/health-mentions.mjs
import { Router } from 'express';

const ROLLING_LABELS = [
  'last_7d','last_30d','last_90d','last_180d','last_365d','last_2y','last_5y','last_10y','all_time',
  'prev_7d','prev_30d','prev_90d','prev_180d','prev_365d',
];
const CALENDAR_LABELS = [
  'this_week','this_month','this_quarter','this_year','last_quarter','last_year',
];

// Static — built from the canonical 11 metrics. Hardcoded here to avoid a
// circular import; if the registry grows, sync this list.
const METRIC_LIST = [
  'weight_lbs','fat_percent',
  'calories','protein_g','carbs_g','fat_g','fiber_g',
  'workout_count','workout_duration_min','workout_calories',
  'tracking_density',
];

/**
 * Create the health-mentions router. Endpoints power the dscli health
 * autocomplete dropdowns in the CoachChat composer.
 *
 * Deps: { mentionSuggestions }
 */
export function createHealthMentionsRouter({
  mentionSuggestions,
}) {
  const router = Router();

  // ── Internal helpers ──

  async function fetchPeriodsInternal({ userId, prefix, limit = 50 }) {
    return mentionSuggestions.periods({ userId, prefix, limit });
  }

  async function fetchRecentDaysInternal({ userId, prefix, has = null, days = 30, limit = 50 }) {
    return mentionSuggestions.recentDays({ userId, prefix, has, days, limit });
  }

  // ── Routes ──

  router.get('/periods', async (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).json({ error: 'user query param required' });
    const prefix = (req.query.prefix || '').toString().toLowerCase();
    res.json({ suggestions: await fetchPeriodsInternal({ userId, prefix }) });
  });

  router.get('/recent-days', async (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).json({ error: 'user query param required' });
    const prefix = (req.query.prefix || '').toString().toLowerCase();
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const has = req.query.has || null;
    res.json({ suggestions: await fetchRecentDaysInternal({ userId, prefix, has, days }) });
  });

  router.get('/metrics', (req, res) => {
    const prefix = (req.query.prefix || '').toString().toLowerCase();
    res.json({ suggestions: mentionSuggestions.metrics({ prefix }) });
  });

  router.get('/all', async (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).json({ error: 'user query param required' });
    const prefix = (req.query.prefix || '').toString().toLowerCase();

    res.json({ suggestions: await mentionSuggestions.all({ userId, prefix }) });
  });

  return router;
}

// ── Helpers ──

function fetchMetricsInternal({ prefix, limit = 50 }) {
  const out = METRIC_LIST.map(name => ({
    slug: name, label: name, value: { metric: name }, group: 'metric',
  }));
  const filtered = prefix
    ? out.filter(s => s.slug.toLowerCase().includes(prefix))
    : out;
  return filtered.slice(0, limit);
}

function humanizeRollingLabel(label) {
  if (label === 'all_time') return 'All time';
  const m = /^(last|prev)_(\d+)([dy])$/.exec(label);
  if (!m) return label;
  const [, kind, n, u] = m;
  const unit = u === 'y' ? 'year' : 'day';
  const plural = parseInt(n, 10) === 1 ? '' : 's';
  return `${kind === 'last' ? 'Last' : 'Previous'} ${n} ${unit}${plural}`;
}

function humanizeCalendarLabel(label) {
  return label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function roundRobin(buckets) {
  const out = [];
  let i = 0;
  let any = true;
  while (any) {
    any = false;
    for (const b of buckets) {
      if (i < b.length) { out.push(b[i]); any = true; }
    }
    i++;
  }
  return out;
}

export default createHealthMentionsRouter;
