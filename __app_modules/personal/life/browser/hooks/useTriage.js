import { useState, useEffect, useCallback, useRef } from 'react';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { useLifeUsername } from "./useLifeUser.js";

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useTriage' });
  return _logger;
}

const BASE = 'api/v1/triage';

/** The API error code for a failed call: the body's `error` when there is one. */
const codeOf = (err) => err?.body?.error ?? null;

/**
 * Triage for the selected Life user: the summary (open to read), the guided session
 * (needs the user's login) and the writes. A 401 `login_required` sets `needsLogin`.
 * Write calls resolve to the response body, or throw an Error carrying `.code` and `.status`.
 */
export function useTriage({ withSession = false } = {}) {
  const username = useLifeUsername();
  const [summary, setSummary] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const seq = useRef(0);

  const url = useCallback((path) => `${BASE}/${path}${username ? `${path.includes('?') ? '&' : '?'}username=${encodeURIComponent(username)}` : ''}`, [username]);

  const call = useCallback(async (name, path, body, method = 'GET') => {
    const start = performance.now();
    try {
      const out = await DaylightAPI(url(path), body ?? {}, method);
      setNeedsLogin(false);
      logger().debug(`life.triage.${name}`, { durationMs: Math.round(performance.now() - start) });
      return out;
    } catch (err) {
      const code = codeOf(err);
      if (err?.status === 401 && code === 'login_required') {
        setNeedsLogin(true);
        logger().info('life.triage.login_required', { call: name });
      } else {
        logger().warn('life.triage.error', { call: name, status: err?.status ?? null, code, error: err?.message });
      }
      throw Object.assign(new Error(code ?? err?.message ?? 'triage_failed'), { code, status: err?.status ?? null });
    }
  }, [url]);

  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const s = await call('summary', 'summary');
      if (mine !== seq.current) return;
      setSummary(s);
      if (withSession && s?.enrolled) {
        try {
          const sess = await call('session', 'session');
          if (mine === seq.current) setSession(sess);
        } catch (err) {
          if (mine === seq.current) setSession(null);
          if (err.code !== 'login_required' && mine === seq.current) setError(err.message);
        }
      }
    } catch (err) {
      if (mine === seq.current) setError(err.message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [call, withSession]);

  useEffect(() => { refetch(); return () => { seq.current += 1; }; }, [refetch]);

  const answer = useCallback((cardId, body) => call('answer', `cards/${encodeURIComponent(cardId)}/answer`, body, 'POST'), [call]);
  const skip = useCallback((cardId) => call('skip', `cards/${encodeURIComponent(cardId)}/skip`, {}, 'POST'), [call]);
  const resolve = useCallback((cardId, happened) => call('resolve', `cards/${encodeURIComponent(cardId)}/resolve`, { happened }, 'POST'), [call]);
  const undo = useCallback((entryId) => call('undo', `log/${encodeURIComponent(entryId)}/undo`, {}, 'POST'), [call]);
  const run = useCallback(async () => {
    const out = await call('run', 'run', {}, 'POST');
    await refetch();
    return out;
  }, [call, refetch]);

  return { summary, session, loading, error, refetch, answer, skip, resolve, undo, run, needsLogin };
}

export default useTriage;
