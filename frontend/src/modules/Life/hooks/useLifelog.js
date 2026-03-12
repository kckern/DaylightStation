import { useState, useEffect, useCallback, useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useLifelog' });
  return _logger;
}

/**
 * Unified hook for all lifelog queries.
 * Supports single-day, date-range, scope, and category modes.
 *
 * @param {Object} params
 * @param {string} [params.username] - defaults to 'kckern'
 * @param {string} [params.date] - single day YYYY-MM-DD
 * @param {string} [params.start] - range start
 * @param {string} [params.end] - range end
 * @param {string} [params.scope] - week|month|season|year|decade
 * @param {string} [params.at] - specific period for scope (YYYY-MM or YYYY)
 * @param {string} [params.category] - filter by extractor category
 */
export function useLifelog(params = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { username = 'kckern', date, start, end, scope, at, category } = params;

  const url = useMemo(() => {
    const base = '/api/v1/life/log';

    if (category) {
      const qs = new URLSearchParams();
      if (start && end) { qs.set('start', start); qs.set('end', end); }
      else if (scope) { qs.set('scope', scope); }
      const q = qs.toString();
      return `${base}/${username}/category/${category}${q ? '?' + q : ''}`;
    }

    if (scope) {
      const qs = at ? `?at=${at}` : '';
      return `${base}/${username}/scope/${scope}${qs}`;
    }

    if (start && end) {
      return `${base}/${username}/range?start=${start}&end=${end}`;
    }

    if (date) {
      return `${base}/${username}/${date}`;
    }

    // Default: week scope
    return `${base}/${username}/scope/week`;
  }, [username, date, start, end, scope, at, category]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    logger().debug('fetch-start', { url });
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      logger().debug('fetch-complete', { url, dayCount: json.days ? Object.keys(json.days).length : 1 });
    } catch (err) {
      setError(err.message);
      logger().error('fetch-error', { url, error: err.message });
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
