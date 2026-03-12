import { useState, useEffect, useCallback, useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useLifePlan' });
  return _logger;
}

const API_BASE = '/api/v1/life/plan';

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Fetches full life plan and provides mutation helpers.
 */
export function useLifePlan(username) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const qs = username ? `?username=${username}` : '';

  const fetchPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api(`/${qs}`);
      setPlan(data);
      logger().debug('plan-loaded', { hasPurpose: !!data.purpose });
    } catch (err) {
      setError(err.message);
      logger().error('plan-load-error', { error: err.message });
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => { fetchPlan(); }, [fetchPlan]);

  const updateSection = useCallback(async (section, data) => {
    try {
      await api(`/${section}${qs}`, { method: 'PATCH', body: JSON.stringify(data) });
      await fetchPlan();
      logger().info('section-updated', { section });
    } catch (err) {
      setError(err.message);
      logger().error('section-update-error', { section, error: err.message });
    }
  }, [qs, fetchPlan]);

  return { plan, loading, error, refetch: fetchPlan, updateSection };
}

/**
 * Fetches goals, optionally filtered by state.
 */
export function useGoals(username, state) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (username) params.set('username', username);
    if (state) params.set('state', state);
    const s = params.toString();
    return s ? `?${s}` : '';
  }, [username, state]);

  const fetchGoals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api(`/goals${qs}`);
      setGoals(data.goals || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => { fetchGoals(); }, [fetchGoals]);

  const transitionGoal = useCallback(async (goalId, newState, reason) => {
    const userQs = username ? `?username=${username}` : '';
    const result = await api(`/goals/${goalId}/transition${userQs}`, {
      method: 'POST',
      body: JSON.stringify({ state: newState, reason }),
    });
    await fetchGoals();
    return result;
  }, [username, fetchGoals]);

  return { goals, loading, error, refetch: fetchGoals, transitionGoal };
}

/**
 * Fetches a single goal by ID with full detail.
 */
export function useGoalDetail(goalId, username) {
  const [goal, setGoal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const qs = username ? `?username=${username}` : '';

  const fetchGoal = useCallback(async () => {
    if (!goalId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api(`/goals/${goalId}${qs}`);
      setGoal(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [goalId, qs]);

  useEffect(() => { fetchGoal(); }, [fetchGoal]);

  return { goal, loading, error, refetch: fetchGoal };
}

/**
 * Fetches beliefs with evidence management.
 */
export function useBeliefs(username) {
  const [beliefs, setBeliefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const qs = username ? `?username=${username}` : '';

  const fetchBeliefs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api(`/beliefs${qs}`);
      setBeliefs(data.beliefs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => { fetchBeliefs(); }, [fetchBeliefs]);

  const addEvidence = useCallback(async (beliefId, evidence) => {
    const result = await api(`/beliefs/${beliefId}/evidence${qs}`, {
      method: 'POST',
      body: JSON.stringify(evidence),
    });
    await fetchBeliefs();
    return result;
  }, [qs, fetchBeliefs]);

  return { beliefs, loading, error, refetch: fetchBeliefs, addEvidence };
}

/**
 * Fetches ceremony/cadence configuration.
 */
export function useCeremonyConfig(username) {
  const [config, setConfig] = useState(null);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const qs = username ? `?username=${username}` : '';

  const fetchCadence = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api(`/cadence${qs}`);
      setConfig(data.config || {});
      setCurrent(data.current || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => { fetchCadence(); }, [fetchCadence]);

  const updateCadence = useCallback(async (updates) => {
    await api(`/cadence${qs}`, { method: 'PATCH', body: JSON.stringify(updates) });
    await fetchCadence();
  }, [qs, fetchCadence]);

  return { config, current, loading, error, refetch: fetchCadence, updateCadence };
}
