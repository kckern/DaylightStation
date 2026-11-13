import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { DaylightAPI } from '@/lib/api.mjs';
import { isLocalDevHost } from '@/lib/kioskEnv.js';
import getLogger from '@/lib/logging/Logger.js';

const REFRESH_MS = 15_000;
const CAPABILITY_ID = 'fitness.skyline-glider';
const LOG_SCOPE = 'skyline_glider';

export function activeSkylineDecision(payload, riderId, at = Date.now(), capabilityId = CAPABILITY_ID) {
  return (payload?.items || [])
    .filter((item) => item?.capabilityId === capabilityId
      && item?.subject?.kind === 'learner'
      && item?.subject?.id === riderId
      && item?.period?.kind === 'interval'
      && /^school-day:\d{4}-\d{2}-\d{2}$/.test(item.period.id || '')
      && Number.isFinite(item.period.startsAt)
      && Number.isFinite(item.period.endsAt)
      && at >= item.period.startsAt && at < item.period.endsAt
      && Number.isFinite(item.validFrom)
      && Number.isFinite(item.validUntil)
      && at >= item.validFrom && at < item.validUntil)
    .sort((left, right) => right.period.startsAt - left.period.startsAt)[0] || null;
}

// The school-day gate for a fitness game. Skyline Glider is the default; another
// game passes its own entitlement capability id and log scope (`skyline_invaders`
// logs `skyline_invaders.access.*` from component `skyline-invaders-access`).
export default function useSkylineAccess(riderId, { schoolLearner, capabilityId = CAPABILITY_ID, logScope = LOG_SCOPE } = {}) {
  const logComponent = `${logScope.replace(/_/g, '-')}-access`;
  const bypassed = isLocalDevHost() || (Boolean(riderId) && schoolLearner === false);
  const generationRef = useRef(0);
  const lastVerdictRef = useRef(null);
  const [snapshot, setSnapshot] = useState(() => bypassed
    ? { riderId, status: 'ready', state: 'not_gated', unlocked: true }
    : { riderId, status: riderId ? 'loading' : 'locked', state: riderId ? null : 'no_identity', unlocked: false });

  const emitVerdict = useCallback((next) => {
    const signature = `${next.riderId}:${next.status}:${next.state}:${next.unlocked}`;
    if (lastVerdictRef.current === signature) return;
    lastVerdictRef.current = signature;
    try {
      getLogger().child({ component: logComponent }).info(`${logScope}.access.verdict`, next);
    } catch { /* authorization never depends on telemetry */ }
  }, [logComponent, logScope]);

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current;
    if (bypassed) {
      const next = { riderId, status: 'ready', state: 'not_gated', unlocked: true };
      emitVerdict(next);
      setSnapshot(next);
      return;
    }
    if (!riderId || riderId === 'guest') {
      const next = { riderId, status: 'locked', state: 'no_identity', unlocked: false };
      emitVerdict(next);
      setSnapshot(next);
      return;
    }
    try {
      const payload = await DaylightAPI(`api/v1/entitlements?${new URLSearchParams({
        capabilityId,
        subjectKind: 'learner',
        subjectId: riderId,
        periodKind: 'interval',
      })}`);
      if (generation !== generationRef.current) return;
      const decision = activeSkylineDecision(payload, riderId, Date.now(), capabilityId);
      const unlocked = decision?.decision === 'granted'
        && decision.degraded !== true
        && decision.basisState !== 'indeterminate';
      const next = {
        riderId,
        status: 'ready',
        state: !decision || decision.degraded || decision.basisState === 'indeterminate'
          ? 'indeterminate'
          : unlocked ? 'complete' : 'incomplete',
        unlocked,
        validUntil: decision?.validUntil ?? null,
      };
      emitVerdict(next);
      setSnapshot(next);
    } catch (error) {
      if (generation !== generationRef.current) return;
      const next = { riderId, status: 'error', state: 'unavailable', unlocked: false };
      try {
        getLogger().child({ component: logComponent }).warn(`${logScope}.access.read_failed`, {
          riderId, error: error?.message || String(error),
        });
      } catch { /* authorization never depends on telemetry */ }
      emitVerdict(next);
      setSnapshot(next);
    }
  }, [bypassed, capabilityId, emitVerdict, logComponent, logScope, riderId]);

  const onStateGates = useCallback((event) => {
    const current = event?.payload?.current;
    const changedCapabilityId = current?.capabilityId || event?.payload?.capabilityId;
    const subjectId = current?.subject?.id || event?.payload?.subject?.id;
    if (changedCapabilityId === capabilityId && (!subjectId || subjectId === riderId)) refresh();
  }, [capabilityId, refresh, riderId]);
  useWebSocketSubscription('state-gates', onStateGates, [onStateGates]);

  useEffect(() => {
    let cancelled = false;
    const guardedRefresh = () => { if (!cancelled) refresh(); };
    guardedRefresh();
    const timer = riderId && !bypassed ? setInterval(guardedRefresh, REFRESH_MS) : null;
    const onVisibility = () => { if (document.visibilityState === 'visible') guardedRefresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      generationRef.current += 1;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [bypassed, refresh, riderId]);

  useEffect(() => {
    if (bypassed || !snapshot.unlocked || !Number.isFinite(snapshot.validUntil)) return undefined;
    const remainingMs = snapshot.validUntil - Date.now();
    if (remainingMs <= 0) {
      setSnapshot({ riderId, status: 'locked', state: 'expired', unlocked: false, validUntil: null });
      void refresh();
      return undefined;
    }
    const timer = setTimeout(() => {
      setSnapshot({ riderId, status: 'locked', state: 'expired', unlocked: false, validUntil: null });
      void refresh();
    }, remainingMs);
    return () => clearTimeout(timer);
  }, [bypassed, refresh, riderId, snapshot.unlocked, snapshot.validUntil]);

  if (snapshot.riderId !== riderId) {
    return bypassed
      ? { riderId, status: 'ready', state: 'not_gated', unlocked: true, refresh }
      : { riderId, status: riderId ? 'loading' : 'locked', state: riderId ? null : 'no_identity', unlocked: false, refresh };
  }
  return { ...snapshot, refresh };
}

// ── A gate over everyone riding ─────────────────────────────────────────────
// A game played by a group (Skyline Invaders: a shooter on the mat, partners on
// the bikes) is gated by every school learner in the fitness session, not by
// whoever is picked as the player: picking a grown-up as the shooter must never
// open the game while a learner who has not finished school is riding.
//
// `learnerIds` are the ids to gate (the caller leaves out people known not to
// be learners). None at all is `not_gated`. The verdict is open only when every
// learner's own verdict is; `blockedBy` lists the ones that are not.

async function readLearnerVerdict(riderId, capabilityId) {
  const payload = await DaylightAPI(`api/v1/entitlements?${new URLSearchParams({
    capabilityId, subjectKind: 'learner', subjectId: riderId, periodKind: 'interval',
  })}`);
  const decision = activeSkylineDecision(payload, riderId, Date.now(), capabilityId);
  const unlocked = decision?.decision === 'granted' && decision.degraded !== true && decision.basisState !== 'indeterminate';
  return {
    riderId, status: 'ready', unlocked, validUntil: decision?.validUntil ?? null,
    state: !decision || decision.degraded || decision.basisState === 'indeterminate' ? 'indeterminate' : unlocked ? 'complete' : 'incomplete',
  };
}

/** Pure: one verdict from each learner's own. */
export function combineLearnerVerdicts(learnerIds, verdicts) {
  if (!learnerIds.length) return { status: 'ready', state: 'not_gated', unlocked: true, blockedBy: [], validUntil: null };
  const each = learnerIds.map((id) => verdicts[id] || { riderId: id, status: 'loading', state: null, unlocked: false });
  if (each.some((v) => v.status === 'loading')) return { status: 'loading', state: null, unlocked: false, blockedBy: [], validUntil: null };
  const blocked = each.filter((v) => !v.unlocked);
  const until = each.map((v) => v.validUntil).filter(Number.isFinite);
  return {
    status: blocked.some((v) => v.status === 'error') ? 'error' : blocked.length ? 'locked' : 'ready',
    // The first blocked learner's reason speaks for the group.
    state: blocked[0]?.state || 'complete',
    unlocked: !blocked.length,
    blockedBy: blocked.map((v) => v.riderId),
    validUntil: until.length ? Math.min(...until) : null,
  };
}

export function useSkylineGroupAccess(learnerIds, { capabilityId = CAPABILITY_ID, logScope = LOG_SCOPE } = {}) {
  const logComponent = `${logScope.replace(/_/g, '-')}-access`;
  const ids = [...new Set((learnerIds || []).filter((id) => id && id !== 'guest'))].sort();
  const key = ids.join('|');
  const bypassed = isLocalDevHost();
  const generationRef = useRef(0);
  const lastVerdictRef = useRef(null);
  const [snapshot, setSnapshot] = useState({ key: null, verdicts: {} });

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current;
    const wanted = key ? key.split('|') : [];
    if (bypassed || !wanted.length) { setSnapshot({ key, verdicts: {} }); return; }
    const entries = await Promise.all(wanted.map(async (id) => {
      try { return [id, await readLearnerVerdict(id, capabilityId)]; } catch (error) {
        try { getLogger().child({ component: logComponent }).warn(`${logScope}.access.read_failed`, { riderId: id, error: error?.message || String(error) }); } catch { /* telemetry never gates */ }
        return [id, { riderId: id, status: 'error', state: 'unavailable', unlocked: false, validUntil: null }];
      }
    }));
    if (generation !== generationRef.current) return;
    setSnapshot({ key, verdicts: Object.fromEntries(entries) });
  }, [bypassed, capabilityId, key, logComponent, logScope]);

  const onStateGates = useCallback((event) => {
    const current = event?.payload?.current;
    const changed = current?.capabilityId || event?.payload?.capabilityId;
    const subjectId = current?.subject?.id || event?.payload?.subject?.id;
    if (changed === capabilityId && (!subjectId || key.split('|').includes(subjectId))) refresh();
  }, [capabilityId, key, refresh]);
  useWebSocketSubscription('state-gates', onStateGates, [onStateGates]);

  useEffect(() => {
    let cancelled = false;
    const guarded = () => { if (!cancelled) refresh(); };
    guarded();
    const timer = key && !bypassed ? setInterval(guarded, REFRESH_MS) : null;
    const onVisibility = () => { if (document.visibilityState === 'visible') guarded(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      generationRef.current += 1;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [bypassed, key, refresh]);

  const verdict = bypassed
    ? { status: 'ready', state: 'not_gated', unlocked: true, blockedBy: [], validUntil: null }
    : combineLearnerVerdicts(ids, snapshot.key === key ? snapshot.verdicts : {});

  // A decision runs out on its own (the school day ends): read again then.
  const { validUntil } = verdict;
  useEffect(() => {
    if (!Number.isFinite(validUntil)) return undefined;
    const timer = setTimeout(() => { setSnapshot({ key: null, verdicts: {} }); void refresh(); }, Math.max(0, validUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [refresh, validUntil]);

  useEffect(() => {
    const signature = `${key}:${verdict.status}:${verdict.state}:${verdict.unlocked}:${verdict.blockedBy.join(',')}`;
    if (lastVerdictRef.current === signature) return;
    lastVerdictRef.current = signature;
    try {
      getLogger().child({ component: logComponent }).info(`${logScope}.access.verdict`, { learners: ids, status: verdict.status, state: verdict.state, unlocked: verdict.unlocked, blockedBy: verdict.blockedBy });
    } catch { /* authorization never depends on telemetry */ }
  });

  return { ...verdict, learners: ids, key, refresh };
}
