/**
 * useWorkoutCoinCeremony — listens for the end of a live workout (announced by
 * FitnessPlayer when a close lands on the finished session), asks the economy
 * what the ride was worth, and holds the ceremony until it is dismissed.
 *
 * Never on a reload: the event only fires on a live close. Never twice for the
 * same ride: sessionStorage remembers, per session, the rings last shown (last
 * 20 sessions). A session outlives the player, so a second video in the same
 * session comes back with MORE rings and is shown again; the same close
 * reported twice (X, then the close watchdog) comes back with the same rings
 * and is skipped, with a log line saying so.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

export const WORKOUT_FINISHED_EVENT = 'fitness-workout-finished';
const SHOWN_KEY = 'fitness.coinCeremony.shown';

function readShown() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SHOWN_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}
function writeShown(sessionId, rings) {
  try {
    const entries = Object.entries(readShown()).filter(([id]) => id !== sessionId);
    entries.push([sessionId, rings]);
    sessionStorage.setItem(SHOWN_KEY, JSON.stringify(Object.fromEntries(entries.slice(-20))));
  } catch { /* storage unavailable: a repeat ceremony is the worst case */ }
}

/**
 * Fire WORKOUT_FINISHED_EVENT for a close that lands on the finished session
 * (not a short browse-out back to the show), once the session's last save has
 * settled — whether it resolved or not. Shared by every close path.
 */
export async function announceWorkoutFinished({ sessionId, redirect, session }) {
  if (!sessionId || !redirect || redirect.returnToShow) return;
  try { await session?.whenFinalPersistSettled?.(); } catch { /* announce anyway */ }
  window.dispatchEvent(new CustomEvent(WORKOUT_FINISHED_EVENT, { detail: { sessionId: String(sessionId) } }));
}

export function useWorkoutCoinCeremony() {
  const log = useMemo(() => getLogger().child({ component: 'workout-coin-ceremony' }), []);
  const [ceremony, setCeremony] = useState(null);

  useEffect(() => {
    const onFinished = async (event) => {
      const sessionId = event?.detail?.sessionId ? String(event.detail.sessionId) : null;
      if (!sessionId) return;
      try {
        const body = await DaylightAPI(`/api/v1/earnings/workout/${sessionId}`);
        if (body?.mode === 'off') { log.info('fitness.coin_ceremony.skipped', { sessionId, reason: 'economy-off' }); return; }
        const learners = (body?.learners || []).filter((l) => l?.rings > 0 || l?.gained?.silver > 0);
        if (!learners.length) { log.info('fitness.coin_ceremony.skipped', { sessionId, reason: 'no-earnings' }); return; }
        const rings = learners.reduce((sum, l) => sum + (l.rings || 0), 0);
        const shownRings = readShown()[sessionId];
        if (Number.isFinite(shownRings) && rings <= shownRings) {
          log.info('fitness.coin_ceremony.skipped', { sessionId, reason: 'already-shown', rings });
          return;
        }
        writeShown(sessionId, rings);
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
