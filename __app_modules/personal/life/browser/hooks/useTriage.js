import { useState, useEffect, useCallback } from 'react';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { useRefreshableRead } from "../../../../../frontend/src/lib/hooks/useRefreshableRead.js";
import { useLifeUsername } from "./useLifeUser.js";

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useTriage' });
  return _logger;
}

const BASE = 'api/v1/triage';

/** The API error code for a failed call: the body's `error` when there is one. */
const codeOf = (err) => err?.body?.error ?? null;
const isLoginRequired = (status, code) => status === 401 && code === 'login_required';

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

  const url = useCallback((path) => `${BASE}/${path}${username ? `${path.includes('?') ? '&' : '?'}username=${encodeURIComponent(username)}` : ''}`, [username]);

  const call = useCallback(async (name, path, body, method = 'GET', { signal, reportLogin = true } = {}) => {
    const start = performance.now();
    try {
      const out = await DaylightAPI(url(path), body ?? {}, method, signal ? { signal } : undefined);
      if (signal?.aborted) return out;
      logger().debug(`life.triage.${name}`, { durationMs: Math.round(performance.now() - start) });
      return out;
    } catch (err) {
      if (signal?.aborted) throw err;
      const code = codeOf(err);
      if (isLoginRequired(err?.status, code)) {
        if (reportLogin) setNeedsLogin(true);
        logger().info('life.triage.login_required', { call: name });
      } else {
        logger().warn('life.triage.error', { call: name, status: err?.status ?? null, code, error: err?.message });
      }
      throw Object.assign(new Error(code ?? err?.message ?? 'triage_failed'), { code, status: err?.status ?? null });
    }
  }, [url]);

  const read = useCallback(async (isCurrent, signal) => {
    const options = { signal, reportLogin: false };
    setLoading(true);
    setError(null);
    try {
      const s = await call('summary', 'summary', undefined, 'GET', options);
      if (!isCurrent()) return;
      setSummary(s);
      const nextSession = withSession && s?.enrolled
        ? await call('session', 'session', undefined, 'GET', options)
        : null;
      if (!isCurrent()) return;
      setSession(nextSession);
      setNeedsLogin(false);
    } catch (err) {
      if (!isCurrent()) return;
      setSession(null);
      const loginRequired = withSession && isLoginRequired(err.status, err.code);
      setNeedsLogin(loginRequired);
      if (!loginRequired) setError(err.message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [call, withSession]);

  const onTimeout = useCallback(() => {
    setSession(null);
    setNeedsLogin(false);
    setError('Triage read timed out');
    setLoading(false);
    logger().warn('life.triage.read_timeout');
  }, []);
  const { reload: refetch } = useRefreshableRead(read, { timeoutMs: 10000, onTimeout });
  useEffect(() => { refetch(); }, [refetch]);

  const answer = useCallback((cardId, body) => call('answer', `cards/${encodeURIComponent(cardId)}/answer`, body, 'POST'), [call]);
  const skip = useCallback((cardId) => call('skip', `cards/${encodeURIComponent(cardId)}/skip`, {}, 'POST'), [call]);
  const resolve = useCallback((cardId, happened) => call('resolve', `cards/${encodeURIComponent(cardId)}/resolve`, { happened }, 'POST'), [call]);
  const log = useCallback((sinceDays = 7, options) => call('log', `log?sinceDays=${encodeURIComponent(sinceDays)}`, undefined, 'GET', options), [call]);
  const undo = useCallback((entryId) => call('undo', `log/${encodeURIComponent(entryId)}/undo`, {}, 'POST'), [call]);
  const run = useCallback(async () => {
    const out = await call('run', 'run', {}, 'POST');
    await refetch();
    return out;
  }, [call, refetch]);

  return { summary, session, loading, error, refetch, answer, skip, resolve, undo, log, run, needsLogin };
}

export default useTriage;
