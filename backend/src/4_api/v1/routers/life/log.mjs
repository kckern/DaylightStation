import { Router } from 'express';
import moment from 'moment-timezone';

const VALID_SCOPES = ['week', 'month', 'season', 'year', 'decade'];

const SCOPE_DAYS = {
  week: 7,
  month: 30,
  season: 90,
  year: 365,
  decade: 3650,
};

function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

function resolveScopeRange(scope, at) {
  if (at) {
    // Specific period: at=YYYY-MM or at=YYYY
    if (/^\d{4}-\d{2}$/.test(at)) {
      const start = moment(at, 'YYYY-MM').startOf('month');
      const end = start.clone().endOf('month');
      return { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD') };
    }
    if (/^\d{4}$/.test(at)) {
      const start = moment(at, 'YYYY').startOf('year');
      const end = start.clone().endOf('year');
      return { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD') };
    }
  }

  const end = moment();
  const days = SCOPE_DAYS[scope] || 30;
  const start = end.clone().subtract(days - 1, 'days');
  return { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD') };
}

function filterByCategory(rangeResult, category) {
  const filtered = { ...rangeResult, days: {} };
  for (const [date, day] of Object.entries(rangeResult.days)) {
    const catData = day.categories?.[category];
    if (catData && Object.keys(catData).length > 0) {
      filtered.days[date] = {
        sources: catData,
        categories: { [category]: catData },
        summaries: day.summaries?.filter(s => s.category === category) || [],
      };
    }
  }
  return filtered;
}

export default function createLogRouter(config) {
  const { aggregator } = config;
  const router = Router();

  // GET /sources — available extractors
  router.get('/sources', (req, res) => {
    const sources = aggregator.getAvailableSources?.() || [];
    res.json({ sources });
  });

  // GET /:username/range?start=&end= — date range
  router.get('/:username/range', async (req, res) => {
    try {
      const { username } = req.params;
      const { start, end } = req.query;

      if (!start || !end || !isValidDate(start) || !isValidDate(end)) {
        return res.status(400).json({ error: 'Both start and end date params required (YYYY-MM-DD)' });
      }

      const result = await aggregator.aggregateRange(username, start, end);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /:username/scope/:scope — week|month|season|year|decade
  router.get('/:username/scope/:scope', async (req, res) => {
    try {
      const { username, scope } = req.params;

      if (!VALID_SCOPES.includes(scope)) {
        return res.status(400).json({ error: `Invalid scope. Must be one of: ${VALID_SCOPES.join(', ')}` });
      }

      const { start, end } = resolveScopeRange(scope, req.query.at);
      const result = await aggregator.aggregateRange(username, start, end);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /:username/category/:category — category filtered
  router.get('/:username/category/:category', async (req, res) => {
    try {
      const { username, category } = req.params;
      const { start, end, scope } = req.query;

      let rangeStart, rangeEnd;
      if (start && end) {
        rangeStart = start;
        rangeEnd = end;
      } else if (scope && VALID_SCOPES.includes(scope)) {
        const resolved = resolveScopeRange(scope);
        rangeStart = resolved.start;
        rangeEnd = resolved.end;
      } else {
        // Default: last 30 days
        const resolved = resolveScopeRange('month');
        rangeStart = resolved.start;
        rangeEnd = resolved.end;
      }

      const result = await aggregator.aggregateRange(username, rangeStart, rangeEnd);
      const filtered = filterByCategory(result, category);
      res.json(filtered);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /:username/:date — single day
  router.get('/:username/:date', async (req, res) => {
    try {
      const { username, date } = req.params;

      if (!isValidDate(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }

      const result = await aggregator.aggregate(username, date);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
