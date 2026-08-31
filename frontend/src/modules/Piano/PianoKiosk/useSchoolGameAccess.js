import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketSubscription } from '../../../hooks/useWebSocket.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';

const REFRESH_MS = 15000;
const UNLOCKED_STATES = new Set(['complete', 'no_work_today']);

export function completionAllowsGames(state) {
  return UNLOCKED_STATES.has(state);
}

export function activePianoGamesDecision(payload, at = Date.now()) {
  return (payload?.items ?? [])
    .filter((item) => item?.capabilityId === 'piano.games'
      && item?.subject?.kind === 'learner'
      && item?.period?.kind === 'interval'
      && Number.isFinite(item.period.startsAt)
      && Number.isFinite(item.period.endsAt)
      && at >= item.period.startsAt && at < item.period.endsAt)
    .sort((left, right) => right.period.startsAt - left.period.startsAt)[0] ?? null;
}

function completionStateForDecision(decision) {
  if (!decision || decision.degraded || decision.basisState === 'indeterminate') return 'indeterminate';
  return decision.decision === 'granted' ? 'complete' : 'incomplete';
}

/**
 * Resolve whether the active piano player may enter Games.
 *
 * The `piano.games` entitlement is purely derived and can reopen during a day,
 * so this is not a one-shot fetch. It refreshes on State Gates events, while
 * mounted, and when the tab becomes visible. Guest has no roster-backed
 * identity; Guest, a missing identity, and a failed read all stay closed.
 */
export default function useSchoolGameAccess(learnerId) {
  const guest = learnerId === 'guest';
  const requestGeneration = useRef(0);
  // THE VERDICT WAS UNLOGGED UNTIL 2026-08-28. Only `read-failed` ever emitted,
  // so a successful read that UNLOCKED games left no trace at all — and on
  // 2026-08-28 that is the case that mattered: a child with unfinished work sat
  // in front of an open games menu and the logs could not say whether the gate
  // had been consulted, what it answered, or which learner it answered for.
  // (The cause was upstream — `GetLearnerDayCompletion` passes
  // `assignedPrograms: false`, so a learner whose whole plan is assigned
  // programs reads `no_work_today` — but nothing on the kiosk side could have
  // shown that.)
  //
  // Edge-triggered on (learner, state, unlocked): the hook refreshes every 15s
  // and a line per refresh would be ~240/hour per kiosk. A transition is the
  // only interesting moment, and it is exactly what a "why were games open?"
  // query needs.
  const lastVerdict = useRef(null);
  const [snapshot, setSnapshot] = useState(() => ({
    learnerId, status: guest ? 'locked' : 'loading', state: null, unlocked: false,
  }));

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!learnerId) {
      setSnapshot({ learnerId, status: 'loading', state: null, unlocked: false });
      return;
    }
    if (learnerId === 'guest') {
      setSnapshot({ learnerId, status: 'locked', state: null, unlocked: false });
      return;
    }

    try {
      const result = await DaylightAPI(
        `api/v1/entitlements?${new URLSearchParams({
          capabilityId: 'piano.games', subjectKind: 'learner',
          subjectId: learnerId, periodKind: 'interval',
        })}`,
      );
      if (generation !== requestGeneration.current) return;
      const decision = activePianoGamesDecision(result);
      const state = completionStateForDecision(decision);
      const unlocked = decision?.decision === 'granted'
        && decision.degraded !== true && decision.basisState !== 'indeterminate';
      const verdict = `${learnerId}:${state}:${unlocked}`;
      if (lastVerdict.current !== verdict) {
        lastVerdict.current = verdict;
        // WRAPPED, and the wrap is not decoration. This call sits inside the
        // try that turns a throw into `status: 'error'` — and `error` LOCKS
        // games. Unwrapped, a logger fault (a transport that is not ready, a
        // child logger missing a level) would lock a child out of a reward
        // they had earned, for a reason that has nothing to do with them.
        // The read outranks the log line.
        try {
          getLogger().child({ component: 'piano-school-access' }).info?.(
            'piano.school-access.verdict',
            // `state` is the field that explains the verdict: `no_work_today`
            // unlocks games exactly as `complete` does, and telling those two
            // apart is the difference between "they finished" and "the gate
            // cannot see their work".
            { learnerId, state, unlocked, basisState: decision?.basisState ?? null },
          );
        } catch { /* never let observability close a gate */ }
      }
      setSnapshot({ learnerId, status: 'ready', state, unlocked });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      getLogger().child({ component: 'piano-school-access' }).warn(
        'piano.school-access.read-failed',
        { learnerId, error: error?.message ?? String(error) },
      );
      setSnapshot({ learnerId, status: 'error', state: null, unlocked: false });
    }
  }, [learnerId]);

  const onStateGates = useCallback((event) => {
    const current = event?.payload?.current;
    const capabilityId = current?.capabilityId ?? event?.payload?.capabilityId ?? null;
    if (capabilityId !== 'piano.games') return;
    const subjectId = current?.subject?.id ?? event?.payload?.subject?.id ?? null;
    if (subjectId && subjectId !== learnerId) return;
    refresh();
  }, [learnerId, refresh]);
  useWebSocketSubscription('state-gates', onStateGates, [onStateGates]);

  useEffect(() => {
    let cancelled = false;
    const guardedRefresh = async () => {
      if (!cancelled) await refresh();
    };
    guardedRefresh();
    const timer = learnerId && !guest ? setInterval(guardedRefresh, REFRESH_MS) : null;
    const onVisibility = () => { if (document.visibilityState === 'visible') guardedRefresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      requestGeneration.current += 1;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, learnerId, guest]);

  // Never project one player's cached unlock onto a newly-selected identity,
  // even for the single render before that identity's effect starts its read.
  const current = snapshot.learnerId === learnerId
    ? snapshot
    : { learnerId, status: guest ? 'locked' : 'loading', state: null, unlocked: false };
  return { ...current, refresh };
}
