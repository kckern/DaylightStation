/**
 * The household roster, for every parent-facing School screen.
 *
 * All three surfaces need the same two things from it: a name to show instead of
 * a bare user id, and the `birthyear` the adult-only rule turns on. It is fetched
 * once per mount and never polled — a roster does not change while a parent
 * marks a worksheet.
 *
 * A roster that will not load is reported, not swallowed: without it there are
 * no names AND no adults, so every sign-off control stays shut. Failing quietly
 * here would look exactly like "nobody in this house is a grown-up".
 *
 * @module Admin/School/useRoster
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { schoolAdminApi } from './schoolAdminApi.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'school-roster' });
  return _logger;
}

/**
 * @returns {{roster: object[], loading: boolean, error: string|null, reload: () => void}}
 */
export function useRoster() {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    schoolAdminApi.roster()
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data) ? data : (data?.roster ?? []);
        setRoster(list);
        setError(null);
        logger().debug('roster-loaded', { count: list.length });
      })
      .catch((err) => {
        if (!alive) return;
        setRoster([]);
        setError(err.message);
        logger().error('roster-failed', { error: err.message, status: err.status });
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const byId = useMemo(() => new Map(roster.map((u) => [u.id, u])), [roster]);
  const nameFor = useCallback((id) => byId.get(id)?.name ?? id ?? 'Unknown', [byId]);

  return { roster, loading, error, reload, nameFor };
}

export default useRoster;
