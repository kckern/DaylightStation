import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { DaylightAPI } from '@/lib/api.mjs';
import { isLocalDevHost } from '@/lib/kioskEnv.js';
import getLogger from '@/lib/logging/Logger.js';

const REFRESH_MS = 15_000;
const CAPABILITY_ID = 'fitness.skyline-glider';

export function activeSkylineDecision(payload, riderId, at = Date.now()) {
  return (payload?.items || [])
    .filter((item) => item?.capabilityId === CAPABILITY_ID
      && item?.subject?.kind === 'learner'
      && item?.subject?.id === riderId
      && item?.period?.kind === 'interval'
      && /^school-day:\d{4}-\d{2}-\d{2}$/.test(item.period.id || '')
      && Number.isFinite(item.period.startsAt)
      && Number.isFinite(item.period.endsAt)
      && at >= item.period.startsAt && at < item.period.endsAt)
    .sort((left, right) => right.period.startsAt - left.period.startsAt)[0] || null;
}

export default function useSkylineAccess(riderId, { schoolLearner } = {}) {
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
      getLogger().child({ component: 'skyline-glider-access' }).info('skyline_glider.access.verdict', next);
    } catch { /* authorization never depends on telemetry */ }
  }, []);

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
    setSnapshot({ riderId, status: 'loading', state: null, unlocked: false });
    try {
      const payload = await DaylightAPI(`api/v1/entitlements?${new URLSearchParams({
        capabilityId: CAPABILITY_ID,
        subjectKind: 'learner',
        subjectId: riderId,
        periodKind: 'interval',
      })}`);
      if (generation !== generationRef.current) return;
      const decision = activeSkylineDecision(payload, riderId);
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
      };
      emitVerdict(next);
      setSnapshot(next);
    } catch (error) {
      if (generation !== generationRef.current) return;
      const next = { riderId, status: 'error', state: 'unavailable', unlocked: false };
      try {
        getLogger().child({ component: 'skyline-glider-access' }).warn('skyline_glider.access.read_failed', {
          riderId, error: error?.message || String(error),
        });
      } catch { /* authorization never depends on telemetry */ }
      emitVerdict(next);
      setSnapshot(next);
    }
  }, [bypassed, emitVerdict, riderId]);

  const onStateGates = useCallback((event) => {
    const current = event?.payload?.current;
    const capabilityId = current?.capabilityId || event?.payload?.capabilityId;
    const subjectId = current?.subject?.id || event?.payload?.subject?.id;
    if (capabilityId === CAPABILITY_ID && (!subjectId || subjectId === riderId)) refresh();
  }, [refresh, riderId]);
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

  if (snapshot.riderId !== riderId) {
    return bypassed
      ? { riderId, status: 'ready', state: 'not_gated', unlocked: true, refresh }
      : { riderId, status: riderId ? 'loading' : 'locked', state: riderId ? null : 'no_identity', unlocked: false, refresh };
  }
  return { ...snapshot, refresh };
}
