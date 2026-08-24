import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';

const REFRESH_MS = 15000;
const UNLOCKED_STATES = new Set(['complete', 'no_work_today']);

export function completionAllowsGames(state) {
  return UNLOCKED_STATES.has(state);
}

/**
 * Resolve whether the active piano player may enter Games.
 *
 * Completion is purely derived and can reopen during a day, so this is not a
 * one-shot fetch. It refreshes while the kiosk is mounted and immediately when
 * the tab becomes visible again. Guest has no roster-backed School identity;
 * Guest, a missing identity, and a failed read all stay closed.
 */
export default function useSchoolGameAccess(learnerId) {
  const guest = learnerId === 'guest';
  const requestGeneration = useRef(0);
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
        `api/v1/school/lifecycle/learners/${encodeURIComponent(learnerId)}/completion`,
      );
      if (generation !== requestGeneration.current) return;
      const state = result?.state ?? null;
      setSnapshot({ learnerId, status: 'ready', state, unlocked: completionAllowsGames(state) });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      getLogger().child({ component: 'piano-school-access' }).warn(
        'piano.school-access.read-failed',
        { learnerId, error: error?.message ?? String(error) },
      );
      setSnapshot({ learnerId, status: 'error', state: null, unlocked: false });
    }
  }, [learnerId]);

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
