import { useState, useCallback } from 'react';
import { invalidateApiResources, resetApiResourceCache, useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { useLifeUsername } from "./useLifeUser.js";

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useLifePlan' });
  return _logger;
}

const API_BASE = '/api/v1/life/plan';
const memberQuery = user => user ? `?username=${encodeURIComponent(user)}` : '';
const goalPath = (goalId, user, action = '') =>
  `${API_BASE}/goals/${encodeURIComponent(goalId)}${action}${memberQuery(user)}`;
const EMPTY_LIST = [];
const EMPTY_CONFIG = {};

function usePlanMember(username) {
  const selected = useLifeUsername();
  return username || selected;
}

// Await the GET after a write. A read failure belongs to the retryable view,
// while the caller still receives the successful write and closes its editor.
function usePlanRead(path, user, label, swr = Boolean(user)) {
  const { data, loading, revalidating, error, refresh } = useApiResource(path, { swr, label, logger: logger() });
  const refetch = useCallback(async () => {
    try { await refresh(); } catch { /* The resource exposes the GET error. */ }
  }, [refresh]);
  const afterWrite = useCallback(async (related = []) => {
    // A committed change also affects the full plan. Drop both old snapshots
    // so returning to the dashboard cannot offer onboarding from a known-empty plan.
    const aggregate = `${API_BASE}/${memberQuery(user)}`;
    const changed = new Set([path, aggregate, ...related]);
    for (const key of changed) resetApiResourceCache(key);
    invalidateApiResources(key => changed.has(key));
    await refetch();
  }, [path, user, refetch]);
  return { data, loading, revalidating, error: error?.message ?? null, refetch, afterWrite };
}

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

export function useLifePlan(username) {
  const user = usePlanMember(username);
  const qs = memberQuery(user);
  const { data: plan, loading, revalidating, error: readError, refetch: fetchPlan, afterWrite: refreshPlan } = usePlanRead(`${API_BASE}/${qs}`, user, 'life plan');
  const [section, setSection] = useState({ user, error: null });
  if (section.user !== user) setSection({ user, error: null });
  const setSectionError = useCallback(error => {
    setSection(current => current.user === user && current.error !== error ? { user, error } : current);
  }, [user]);
  const refetch = useCallback(async () => {
    setSectionError(null);
    await fetchPlan();
  }, [fetchPlan, setSectionError]);

  const afterWrite = useCallback(async () => {
    setSectionError(null);
    await refreshPlan();
  }, [refreshPlan, setSectionError]);

  const updateSection = useCallback(async (sectionName, data) => {
    try {
      await DaylightAPI(`${API_BASE}/${sectionName}${qs}`, data, 'PATCH');
      await afterWrite();
      logger().info('section-updated', { section: sectionName });
    } catch (err) {
      setSectionError(err.message);
      logger().error('section-update-error', { section: sectionName, error: err.message });
      throw err;
    }
  }, [qs, afterWrite, setSectionError]);

  // Create-or-update the purpose statement. Unlike updateSection('purpose', ...)
  // (a PATCH against an existing plan section, which 404s for a planless user),
  // this POSTs to a dedicated endpoint that creates the plan/section if absent.
  // Throws on failure so the caller (the editor) can surface the error inline
  // instead of losing the user's draft.
  const setPurpose = useCallback(async (statement) => {
    const purpose = await DaylightAPI(`${API_BASE}/purpose${qs}`, { statement }, 'POST');
    await afterWrite();
    logger().info('purpose-set');
    return purpose;
  }, [qs, afterWrite]);

  // Author a new value (backend assigns the next rank). Throws on failure so
  // the caller (modal) can surface the error inline; refetches on success.
  const createValue = useCallback(async ({ name, description } = {}) => {
    const value = await DaylightAPI(`${API_BASE}/values${qs}`, { name, description }, 'POST');
    await afterWrite();
    logger().info('value-created', { valueId: value?.id });
    return value;
  }, [qs, afterWrite]);

  return {
    plan, isEmpty: planIsEmpty(plan), loading, revalidating, readError, error: readError ?? section.error,
    refetch, updateSection, setPurpose, createValue,
  };
}

function goalListPath(user, state) {
  const params = new URLSearchParams();
  if (user) params.set('username', user);
  if (state) params.set('state', state);
  return `${API_BASE}/goals${params.size ? `?${params}` : ''}`;
}

function useGoalTransition(user, afterWrite) {
  return useCallback(async (goalId, newState, reason) => {
    const result = await DaylightAPI(goalPath(goalId, user, '/transition'), { state: newState, reason }, 'POST');
    await afterWrite([goalPath(goalId, user), goalListPath(user)]);
    return result;
  }, [user, afterWrite]);
}

/**
 * Fetches goals, optionally filtered by state.
 */
export function useGoals(username, state) {
  const user = usePlanMember(username);
  const { data, loading, revalidating, error, refetch, afterWrite } = usePlanRead(goalListPath(user, state), user, 'life goals');
  const transitionGoal = useGoalTransition(user, afterWrite);

  // Author a new goal. Throws on failure so the caller can surface the error
  // inline; refetches the goal list on success and returns the created goal.
  const createGoal = useCallback(async ({ name, why, milestone } = {}) => {
    const goal = await DaylightAPI(`${API_BASE}/goals${memberQuery(user)}`, { name, why, milestone }, 'POST');
    await afterWrite();
    logger().info('goal-created', { goalId: goal?.id });
    return goal;
  }, [user, afterWrite]);

  return { goals: data?.goals || EMPTY_LIST, loading, revalidating, error, refetch, transitionGoal, createGoal };
}

/**
 * Fetches a single goal by ID with full detail.
 */
export function useGoalDetail(goalId, username) {
  const user = usePlanMember(username);
  const path = goalId ? goalPath(goalId, user) : null;
  const { data: goal, loading, error, refetch, afterWrite } = usePlanRead(path, user, 'goal detail', false);
  const transitionGoal = useGoalTransition(user, afterWrite);
  return { goal, loading, error, refetch, transitionGoal };
}

/**
 * Fetches beliefs with evidence management.
 */
export function useBeliefs(username) {
  const user = usePlanMember(username);
  const qs = memberQuery(user);
  const path = `${API_BASE}/beliefs${qs}`;
  const { data, loading, error, refetch, afterWrite } = usePlanRead(path, user, 'life beliefs');

  const addEvidence = useCallback(async (beliefId, evidence) => {
    const result = await DaylightAPI(`${API_BASE}/beliefs/${beliefId}/evidence${qs}`, evidence, 'POST');
    await afterWrite();
    return result;
  }, [qs, afterWrite]);

  // Author a new belief. Throws on failure so the caller can surface the error
  // inline; refetches on success and returns the created belief.
  const createBelief = useCallback(async ({ if_hypothesis, then_outcome } = {}) => {
    const belief = await DaylightAPI(path, { if_hypothesis, then_outcome }, 'POST');
    await afterWrite();
    logger().info('belief-created', { beliefId: belief?.id });
    return belief;
  }, [path, afterWrite]);

  return { beliefs: data?.beliefs || EMPTY_LIST, loading, error, refetch, addEvidence, createBelief };
}

/**
 * Fetches ceremony/cadence configuration.
 */
export function useCeremonyConfig(username) {
  const user = usePlanMember(username);
  const qs = memberQuery(user);
  const path = `${API_BASE}/cadence${qs}`;
  const { data, loading, error, refetch, afterWrite } = usePlanRead(path, user, 'life cadence');
  const setCeremonyEnabled = useCallback(async (type, enabled) => {
    await DaylightAPI(`${API_BASE}/ceremonies/${encodeURIComponent(type)}${qs}`, { enabled }, 'PATCH');
    await afterWrite();
  }, [qs, afterWrite]);

  return {
    ceremonies: data?.ceremonies || EMPTY_CONFIG,
    current: data ? data.current || EMPTY_CONFIG : null,
    loading: loading && !data,
    readingBack: loading && Boolean(data),
    error, refetch, setCeremonyEnabled,
  };
}
