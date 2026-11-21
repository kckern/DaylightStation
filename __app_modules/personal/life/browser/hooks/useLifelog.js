import { useMemo } from 'react';
import { useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import { useLifeUsername } from "./useLifeUser.js";

/**
 * Unified hook for all lifelog queries.
 * Supports single-day, date-range, scope, and category modes.
 *
 * @param {Object} params
 * @param {string} [params.username] - defaults to 'user_1'
 * @param {string} [params.date] - single day YYYY-MM-DD
 * @param {string} [params.start] - range start
 * @param {string} [params.end] - range end
 * @param {string} [params.scope] - week|month|season|year|decade
 * @param {string} [params.at] - specific period for scope (YYYY-MM or YYYY)
 * @param {string} [params.category] - filter by extractor category
 */
export function useLifelog(params = {}) {
  // Default to the backend-resolved user from LifeUserContext (provided by
  // LifeApp); 'user_1' is the last-resort legacy fallback outside a provider.
  const contextUsername = useLifeUsername();
  const { username = contextUsername || 'user_1', date, start, end, scope, at, category } = params;

  const url = useMemo(() => {
    const base = `/api/v1/life/log/${encodeURIComponent(username)}`;

    if (category) {
      const qs = new URLSearchParams();
      if (start && end) { qs.set('start', start); qs.set('end', end); }
      else if (scope) { qs.set('scope', scope); }
      const q = qs.toString();
      return `${base}/category/${encodeURIComponent(category)}${q ? '?' + q : ''}`;
    }

    if (scope) {
      const qs = at ? `?at=${encodeURIComponent(at)}` : '';
      return `${base}/scope/${encodeURIComponent(scope)}${qs}`;
    }

    if (start && end) {
      return `${base}/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    }

    if (date) {
      return `${base}/${encodeURIComponent(date)}`;
    }

    // Default: week scope
    return `${base}/scope/week`;
  }, [username, date, start, end, scope, at, category]);

  const { data, loading, error, reload } = useApiResource(url, { label: 'lifelog' });
  return { data, loading, error: error?.message ?? null, refetch: reload };
}
