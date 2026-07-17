import { useState, useEffect, useCallback, useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { useLifeUsername } from './useLifeUser.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useLifePlan' });
  return _logger;
}

const API_BASE = '/api/v1/life/plan';

// A plan is "empty" when it has no substance yet: no object, no keys, or no
// goals/values/beliefs/qualities/purpose. Consumers (e.g. the dashboard
// funnel) use this to decide whether to route a new user to the coach.
export function planIsEmpty(plan) {
  if (!plan || Object.keys(plan).length === 0) return true;
  return (plan.goals?.length ?? 0) === 0
    && (plan.values?.length ?? 0) === 0
    && (plan.beliefs?.length ?? 0) === 0
    && (plan.qualities?.length ?? 0) === 0
    && !plan.purpose;
}

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

  const ctxUsername = useLifeUsername();
  const user = username || ctxUsername;
  const qs = user ? `?username=${encodeURIComponent(user)}` : '';

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

  const isEmpty = useMemo(() => planIsEmpty(plan), [plan]);

  const updateSection = useCallback(async (section, data) => {
    try {
      await api(`/${section}${qs}`, { method: 'PATCH', body: JSON.stringify(data) });
      await fetchPlan();
      logger().info('section-updated', { section });
    } catch (err) {
      setError(err.message);
      logger().error('section-update-error', { section, error: err.message });
      throw err;
    }
  }, [qs, fetchPlan]);

  // Create-or-update the purpose statement. Unlike updateSection('purpose', ...)
  // (a PATCH against an existing plan section, which 404s for a planless user),
  // this POSTs to a dedicated endpoint that creates the plan/section if absent.
  // Throws on failure so the caller (the editor) can surface the error inline
  // instead of losing the user's draft.
  const setPurpose = useCallback(async (statement) => {
    const purpose = await api(`/purpose${qs}`, { method: 'POST', body: JSON.stringify({ statement }) });
    await fetchPlan();
    logger().info('purpose-set');
    return purpose;
  }, [qs, fetchPlan]);

  // Author a new value (backend assigns the next rank). Throws on failure so
  // the caller (modal) can surface the error inline; refetches on success.
  const createValue = useCallback(async ({ name, description } = {}) => {
    const value = await api(`/values${qs}`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
    await fetchPlan();
    logger().info('value-created', { valueId: value?.id });
    return value;
  }, [qs, fetchPlan]);

  return { plan, isEmpty, loading, error, refetch: fetchPlan, updateSection, setPurpose, createValue };
}

/**
 * Fetches goals, optionally filtered by state.
 */
export function useGoals(username, state) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const ctxUsername = useLifeUsername();
  const user = username || ctxUsername;

  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (user) params.set('username', user);
    if (state) params.set('state', state);
    const s = params.toString();
    return s ? `?${s}` : '';
  }, [user, state]);

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
    const userQs = user ? `?username=${encodeURIComponent(user)}` : '';
    const result = await api(`/goals/${goalId}/transition${userQs}`, {
      method: 'POST',
      body: JSON.stringify({ state: newState, reason }),
    });
    await fetchGoals();
    return result;
  }, [user, fetchGoals]);

  // Author a new goal. Throws on failure so the caller can surface the error
  // inline; refetches the goal list on success and returns the created goal.
  const createGoal = useCallback(async ({ name, why, milestone } = {}) => {
    const userQs = user ? `?username=${encodeURIComponent(user)}` : '';
    const goal = await api(`/goals${userQs}`, {
      method: 'POST',
      body: JSON.stringify({ name, why, milestone }),
    });
    await fetchGoals();
    logger().info('goal-created', { goalId: goal?.id });
    return goal;
  }, [user, fetchGoals]);

  return { goals, loading, error, refetch: fetchGoals, transitionGoal, createGoal };
}

/**
 * Fetches a single goal by ID with full detail.
 */
export function useGoalDetail(goalId, username) {
  const [goal, setGoal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const ctxUsername = useLifeUsername();
  const user = username || ctxUsername;
  const qs = user ? `?username=${encodeURIComponent(user)}` : '';

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

  const ctxUsername = useLifeUsername();
  const user = username || ctxUsername;
  const qs = user ? `?username=${encodeURIComponent(user)}` : '';

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

  // Author a new belief. Throws on failure so the caller can surface the error
  // inline; refetches on success and returns the created belief.
  const createBelief = useCallback(async ({ if_hypothesis, then_outcome } = {}) => {
    const belief = await api(`/beliefs${qs}`, {
      method: 'POST',
      body: JSON.stringify({ if_hypothesis, then_outcome }),
    });
    await fetchBeliefs();
    logger().info('belief-created', { beliefId: belief?.id });
    return belief;
  }, [qs, fetchBeliefs]);

  return { beliefs, loading, error, refetch: fetchBeliefs, addEvidence, createBelief };
}

/**
 * Fetches ceremony/cadence configuration.
 */
export function useCeremonyConfig(username) {
  const [config, setConfig] = useState(null);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const ctxUsername = useLifeUsername();
  const user = username || ctxUsername;
  const qs = user ? `?username=${encodeURIComponent(user)}` : '';

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
