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
 * Deps: { healthAnalyticsService, healthStore?, healthService?, now? }
 */
export function createHealthMentionsRouter({
  healthAnalyticsService,
  healthStore = null,
  healthService = null,
  now = () => new Date(),
}) {
  const router = Router();

  router.get('/periods', async (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).json({ error: 'user query param required' });
    const prefix = (req.query.prefix || '').toString().toLowerCase();
    const out = [];

    // Rolling vocab
    for (const label of ROLLING_LABELS) {
      out.push({
        slug: label,
        label: humanizeRollingLabel(label),
        value: { rolling: label },
        group: 'period',
      });
    }
    // Calendar named labels
    for (const label of CALENDAR_LABELS) {
      out.push({
        slug: label,
        label: humanizeCalendarLabel(label),
        value: { calendar: label },
        group: 'period',
      });
    }
    // Named periods
    if (healthAnalyticsService?.listPeriods) {
      try {
        const r = await healthAnalyticsService.listPeriods({ userId });
        for (const p of (r.periods || [])) {
          out.push({
            slug: p.slug,
            label: p.label || p.slug,
            value: { named: p.slug },
            group: 'period',
            subSource: p.source,
          });
        }
      } catch { /* surface as no named periods */ }
    }

    const filtered = prefix
      ? out.filter(s =>
          s.slug.toLowerCase().includes(prefix) ||
          (s.label || '').toLowerCase().includes(prefix))
      : out;

    res.json({ suggestions: filtered });
  });

  router.get('/recent-days', async (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).json({ error: 'user query param required' });
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const has = req.query.has || null;

    const today = now();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const fromDate = new Date(todayUtc);
    fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = todayUtc.toISOString().slice(0, 10);

    const [weight, nutrition, range] = await Promise.all([
      healthStore?.loadWeightData?.(userId).catch(() => ({})) ?? Promise.resolve({}),
      healthStore?.loadNutritionData?.(userId).catch(() => ({})) ?? Promise.resolve({}),
      healthService?.getHealthForRange?.(userId, fromStr, toStr).catch(() => ({})) ?? Promise.resolve({}),
    ]);

    const results = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(todayUtc);
      d.setUTCDate(todayUtc.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      const hasWeight = !!weight?.[date];
      const hasNutrition = !!nutrition?.[date] && (nutrition[date].calories ?? 0) > 0;
      const hasWorkout = Array.isArray(range?.[date]?.workouts) && range[date].workouts.length > 0;

      const entry = {
        slug: date,
        label: date,
        value: { date },
        group: 'day',
        has: { weight: hasWeight, nutrition: hasNutrition, workout: hasWorkout },
      };
      if (has === 'weight'    && !hasWeight)    continue;
      if (has === 'nutrition' && !hasNutrition) continue;
      if (has === 'workout'   && !hasWorkout)   continue;
      results.push(entry);
    }

    res.json({ suggestions: results });
  });

  router.get('/metrics', (req, res) => {
    const prefix = (req.query.prefix || '').toString().toLowerCase();
    const out = METRIC_LIST.map(name => ({
      slug: name, label: name, value: { metric: name }, group: 'metric',
    }));
    const filtered = prefix
      ? out.filter(s => s.slug.toLowerCase().includes(prefix))
      : out;
    res.json({ suggestions: filtered });
  });

  router.get('/all', async (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).json({ error: 'user query param required' });
    const prefix = (req.query.prefix || '').toString().toLowerCase();

    const fanout = await Promise.all([
      // periods (rolling + calendar + named)
      (async () => {
        const fakeReq = { query: { user: userId, prefix } };
        let captured;
        const fakeRes = { json: (b) => { captured = b; }, status: () => ({ json: () => {} }) };
        const findPeriods = router.stack.find(l => l.route?.path === '/periods');
        if (findPeriods) await findPeriods.route.stack[0].handle(fakeReq, fakeRes);
        return captured?.suggestions || [];
      })(),
      // metric vocab
      (async () => {
        const out = METRIC_LIST.map(name => ({
          slug: name, label: name, value: { metric: name }, group: 'metric',
        }));
        return prefix ? out.filter(s => s.slug.toLowerCase().includes(prefix)) : out;
      })(),
    ]);

    const merged = [...fanout[0], ...fanout[1]];
    res.json({ suggestions: merged.slice(0, 20) });
  });

  return router;
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

export default createHealthMentionsRouter;
