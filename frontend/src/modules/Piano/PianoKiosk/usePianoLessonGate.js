import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useWebSocketSubscription } from '../../../hooks/useWebSocket.js';
import getLogger from '../../../lib/logging/Logger.js';

const REFRESH_MS = 15000;

/** School's one broadcast topic; the ceremony bridge and bypass writes share it. */
const SCHOOL_TOPIC = 'school';

/** The two School events that can change whether today's lesson is still owed. */
const RELEVANT_EVENTS = new Set(['piano-lesson-complete', 'program-day-bypass-changed']);

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-lesson-gate' });
  return _logger;
}

const open = (learnerId, status) => ({
  learnerId, status, gated: false, course: null, unit: null, lesson: null,
});

/**
 * Live "does this learner owe today's piano lesson?" for the kiosk menu.
 *
 * Modelled on `useSchoolGameAccess` — same 15s poll, same visibilitychange
 * refresh, same per-learner request-generation guard so one player's answer
 * can never be projected onto a newly-picked identity — with two deliberate
 * differences:
 *
 * FAILS OPEN. Any failed read (including the 404 of a School-less install)
 * resolves to NOT gated, and so does the first in-flight fetch. The gate hides
 * the entire menu, so a wrong `true` locks a child out of every mode over a
 * transient fault, while a wrong `false` merely fails to nag them. Only the
 * second is acceptable. (`useSchoolGameAccess` fails CLOSED for the opposite
 * reason: it guards a reward.)
 *
 * PUSHED, NOT ONLY POLLED. A completed lesson and a parent's Teacher Console
 * bypass both broadcast on the `school` topic, so the menu comes back within a
 * beat instead of up to 15s. The poll stays as the fallback for a dropped
 * socket. Events are a trigger to RE-READ, never a payload to trust: the
 * completion rule has exactly one owner, on the backend.
 *
 * @param {string|null} learnerId - the active kiosk player
 * @returns {{status: 'loading'|'ready'|'error', gated: boolean,
 *   course: object|null, unit: object|null, lesson: object|null, refresh: Function}}
 */
export function usePianoLessonGate(learnerId) {
  const guest = !learnerId || learnerId === 'guest';
  const requestGeneration = useRef(0);
  const [snapshot, setSnapshot] = useState(() => open(learnerId, guest ? 'ready' : 'loading'));

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (guest) {
      setSnapshot(open(learnerId, 'ready'));
      return;
    }
    try {
      const result = await DaylightAPI(
        `api/v1/school/lifecycle/learners/${encodeURIComponent(learnerId)}/piano-lesson-gate`,
      );
      if (generation !== requestGeneration.current) return;
      const gated = result?.gated === true;
      setSnapshot((prev) => {
        if (prev.learnerId === learnerId && prev.gated !== gated) {
          logger().info('piano.lesson-gate.change', { learnerId, gated, reason: result?.reason ?? null });
        }
        return {
          learnerId,
          status: 'ready',
          gated,
          course: gated ? result.course ?? null : null,
          unit: gated ? result.unit ?? null : null,
          lesson: gated ? result.lesson ?? null : null,
        };
      });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      logger().warn('piano.lesson-gate.read-failed', { learnerId, error: error?.message ?? String(error) });
      setSnapshot(open(learnerId, 'error'));
    }
  }, [learnerId, guest]);

  useEffect(() => {
    let cancelled = false;
    const guarded = async () => { if (!cancelled) await refresh(); };
    guarded();
    const timer = guest ? null : setInterval(guarded, REFRESH_MS);
    const onVisibility = () => { if (document.visibilityState === 'visible') guarded(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      requestGeneration.current += 1;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, guest]);

  useWebSocketSubscription(SCHOOL_TOPIC, (msg) => {
    if (!RELEVANT_EVENTS.has(msg?.event) || msg?.learnerId !== learnerId) return;
    logger().debug('piano.lesson-gate.push-refresh', { learnerId, event: msg.event });
    refresh();
  }, [learnerId, refresh]);

  // Never render a previous learner's gate for the frame between a switch and
  // that learner's own read landing.
  const current = snapshot.learnerId === learnerId
    ? snapshot
    : open(learnerId, guest ? 'ready' : 'loading');
  return { ...current, refresh };
}

export default usePianoLessonGate;
