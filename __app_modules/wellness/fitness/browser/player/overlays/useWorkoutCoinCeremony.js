/**
 * useWorkoutCoinCeremony — listens for the end of a live workout (fired by
 * FitnessPlayer once the final session save has landed), asks the economy
 * what the ride was worth, and holds the ceremony until it is dismissed.
 * Never on a reload (the event only fires on a live close) and never twice
 * for one session (sessionStorage remembers the last 20 shown).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

export const WORKOUT_FINISHED_EVENT = 'fitness-workout-finished';
const SHOWN_KEY = 'fitness.coinCeremony.shown';

function readShown() {
  try { return JSON.parse(sessionStorage.getItem(SHOWN_KEY) || '[]'); } catch { return []; }
}
export function wasShown(sessionId) { return readShown().includes(sessionId); }
export function markShown(sessionId) {
  try { sessionStorage.setItem(SHOWN_KEY, JSON.stringify([...readShown().filter((id) => id !== sessionId), sessionId].slice(-20))); } catch { /* storage unavailable */ }
}

export function useWorkoutCoinCeremony() {
  const log = useMemo(() => getLogger().child({ component: 'workout-coin-ceremony' }), []);
  const [ceremony, setCeremony] = useState(null);

  useEffect(() => {
    const onFinished = async (event) => {
      const sessionId = event?.detail?.sessionId ? String(event.detail.sessionId) : null;
      if (!sessionId || wasShown(sessionId)) return;
      markShown(sessionId);
      try {
        const body = await DaylightAPI(`/api/v1/earnings/workout/${sessionId}`);
        if (body?.mode === 'off') { log.info('fitness.coin_ceremony.skipped', { sessionId, reason: 'economy-off' }); return; }
        const learners = (body?.learners || []).filter((l) => l?.rings > 0 || l?.gained?.silver > 0);
        if (!learners.length) { log.info('fitness.coin_ceremony.skipped', { sessionId, reason: 'no-earnings' }); return; }
        setCeremony({ sessionId, learners });
      } catch (err) {
        log.info('fitness.coin_ceremony.skipped', { sessionId, reason: 'fetch-failed', error: err?.message });
      }
    };
    window.addEventListener(WORKOUT_FINISHED_EVENT, onFinished);
    return () => window.removeEventListener(WORKOUT_FINISHED_EVENT, onFinished);
  }, [log]);

  const dismiss = useCallback(() => setCeremony(null), []);
  return { ceremony, dismiss };
}
