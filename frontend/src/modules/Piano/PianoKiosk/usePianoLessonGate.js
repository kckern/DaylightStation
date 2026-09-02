import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useWebSocketSubscription } from '../../../hooks/useWebSocket.js';
import getLogger from '../../../lib/logging/Logger.js';

export const REFRESH_MS = 15000;

/**
 * How long a non-guest learner's menu stays PENDING (tiles disabled) waiting
 * for a verdict. The cold read was measured at 11.1s on 2026-09-01; this is
 * the smallest round value comfortably clear of that. Past it a read is
 * treated as broken and the menu opens, because a real fault must not leave a
 * child staring at a dead screen.
 *
 * Written against REFRESH_MS because it has to outlast a poll interval: a read
 * that FAILS fast leaves the learner pending (see the catch below), and the
 * next poll is that read's retry. The retry only has room to land while the
 * backend is warm — a cold one launched at 15s cannot answer by 20s. Buying
 * the cold case would mean ~30s, trading a rare recovery for 30s of dead
 * kiosk screen, which is the worse side to be wrong on.
 */
export const LOADING_CEILING_MS = REFRESH_MS + 5000;

/**
 * The one wording for "your verdict has not landed yet", shared by every
 * consumer that renders the pending state (PianoMenu's caption, the Videos
 * course-grid placeholder). Two screens saying it two slightly different ways
 * is how a rule stops being one rule.
 */
export const PENDING_CAPTION = 'Checking today\u2019s lesson\u2026';

/** School's one broadcast topic; the ceremony bridge and bypass writes share it. */
const SCHOOL_TOPIC = 'school';

/** The two School events that can change whether today's lesson is still owed. */
const RELEVANT_EVENTS = new Set(['piano-lesson-complete', 'program-day-bypass-changed']);

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-lesson-gate' });
  return _logger;
}

/**
 * The open verdict, in every sense: not owed a lesson AND not capped.
 *
 * `videos` is kept separate from `gated` on purpose. `gated` funnels the kiosk
 * INTO today's lesson video; the cap stops video altogether. A consumer that
 * read one for the other would launch a lesson at the learner it is trying to
 * stop, so they never collapse into one flag.
 */
const OPEN_VIDEOS = Object.freeze({ locked: false, reason: 'no-cap', completedToday: 0, cap: null });

const open = (learnerId, status) => ({
  learnerId, status, gated: false, course: null, unit: null, lesson: null, challenge: null,
  videos: { ...OPEN_VIDEOS },
});

/**
 * Live "does this learner owe today's piano lesson?" for the kiosk menu.
 *
 * Modelled on `useSchoolGameAccess` — same 15s poll, same visibilitychange
 * refresh, same per-learner request-generation guard so one player's answer
 * can never be projected onto a newly-picked identity — with two deliberate
 * differences:
 *
 * FAILS OPEN, BUT NOT INSTANTLY. Every way of not knowing resolves to NOT
 * gated in the end: the gate hides the entire menu, so a wrong `true` locks a
 * child out of every mode over a transient fault, while a wrong `false` merely
 * fails to nag them. (`useSchoolGameAccess` fails CLOSED for the opposite
 * reason: it guards a reward.) What is NOT acceptable is opening instantly on
 * a non-answer — on 2026-09-01 a learner walked out through a menu that
 * rendered wide open for the 11.1s a cold read took. So:
 *
 *   loading  no answer yet, and no answer has ever been recorded for this
 *            learner. `pending` is true; consumers must shut their doors.
 *            A transient failure (network, 5xx) stays here and lets the poll
 *            retry, because a read that fails in 200ms is no more informative
 *            than one that hangs.
 *   timeout  no answer within LOADING_CEILING_MS. Opens. A real fault must
 *            never leave a child staring at a dead screen.
 *   error    a definite refusal (any 4xx — notably the 404 of a School-less
 *            install). Opens at once; retrying it would only stall the kiosk.
 *   ready    School answered. `gated` is then meaningful, and only then.
 *
 * A learner whose verdict has landed never returns to `loading`.
 *
 * A hung poll leaves the last known verdict standing, so a slow server can
 * never reopen a gate that read as owed.
 *
 * PUSHED, NOT ONLY POLLED. A completed lesson and a parent's Teacher Console
 * bypass both broadcast on the `school` topic, so the menu comes back within a
 * beat instead of up to 15s. The poll stays as the fallback for a dropped
 * socket. Events are a trigger to RE-READ, never a payload to trust: the
 * completion rule has exactly one owner, on the backend.
 *
 * @param {string|null} learnerId - the active kiosk player
 * @returns {{status: 'loading'|'ready'|'error'|'timeout', pending: boolean,
 *   gated: boolean, course: object|null, unit: object|null, lesson: object|null,
 *   challenge: object|null, refresh: Function}}
 *   `pending` is the one flag a consumer needs: true exactly while this
 *   learner's verdict is outstanding. Never true for a guest.
 */
export function usePianoLessonGate(learnerId) {
  const guest = !learnerId || learnerId === 'guest';
  const requestGeneration = useRef(0);
  // { learnerId, timer } — the ONE pending ceiling for that learner. A null
  // timer means their verdict has landed and no further ceiling is owed.
  const ceiling = useRef(null);
  const [snapshot, setSnapshot] = useState(() => open(learnerId, guest ? 'ready' : 'loading'));

  const settleCeiling = useCallback((id) => {
    if (ceiling.current?.timer) clearTimeout(ceiling.current.timer);
    ceiling.current = { learnerId: id, timer: null };
  }, []);

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (guest) {
      settleCeiling(learnerId);
      setSnapshot(open(learnerId, 'ready'));
      return;
    }
    // Write the switch into STATE, not just the render-time fallback at the
    // bottom of this hook. The ceiling's updater matches on
    // `prev.learnerId === learnerId`, so without this anchor a learner who was
    // switched to while their read hangs would never reach `timeout` at all.
    setSnapshot((prev) => (prev.learnerId === learnerId ? prev : open(learnerId, 'loading')));
    // Armed once per LEARNER, not per request — the reason is the 15s poll,
    // which always fires inside this window. A per-request ceiling has to
    // decide what to do about the request that poll supersedes, and both
    // answers are wrong. Keep this hook's request-generation guard inside the
    // ceiling callback and the poll pre-empts every ceiling 5s before it is
    // due, so none of them ever fires (measured: still 'loading' at t=20s).
    // Drop that guard and a ceiling armed for the learner who walked away can
    // flip the one who just sat down, cutting their promised wait short
    // (measured: 'timeout' at 15s of a 20s ceiling).
    //
    // Division of labour, because the field names mislead: the `learnerId`
    // stored here is NOT what keeps A's ceiling off B. A switch rebuilds
    // `refresh`, so the effect below tears down and re-runs, and its cleanup
    // nulls this ref before B's first read — by the time we reach this guard
    // the ref is only ever null or B's own. Cross-learner safety comes from
    // that cleanup plus the `prev.learnerId === learnerId` check inside the
    // updater. What `learnerId` does here is act as the sentinel that tells
    // "settled, do not re-arm" (timer null, same learner) apart from "never
    // armed" (null ref).
    if (ceiling.current?.learnerId !== learnerId) {
      if (ceiling.current?.timer) clearTimeout(ceiling.current.timer);
      ceiling.current = {
        learnerId,
        timer: setTimeout(() => {
          // Only reachable while this learner's first read is outstanding: any
          // verdict clears the timer.
          ceiling.current = { learnerId, timer: null };
          logger().warn('piano.lesson-gate.loading-timeout', { learnerId, ceilingMs: LOADING_CEILING_MS });
          setSnapshot((prev) => (prev.learnerId === learnerId && prev.status === 'loading'
            ? { ...prev, status: 'timeout' }
            : prev));
        }, LOADING_CEILING_MS),
      };
    }
    try {
      const result = await DaylightAPI(
        `api/v1/school/lifecycle/learners/${encodeURIComponent(learnerId)}/piano-lesson-gate`,
      );
      if (generation !== requestGeneration.current) return;
      settleCeiling(learnerId);
      const gated = result?.gated === true;
      // FAILS OPEN, like every other unknown here: a School that has never
      // heard of this field, or a payload that lost it, must not take Videos
      // away from a child who has watched nothing. Only an explicit `true`
      // locks.
      const videos = result?.videos?.locked === true
        ? {
          locked: true,
          reason: result.videos.reason ?? 'daily-cap',
          completedToday: result.videos.completedToday ?? null,
          cap: result.videos.cap ?? null,
        }
        : { ...OPEN_VIDEOS, ...(result?.videos ?? {}), locked: false };
      setSnapshot((prev) => {
        if (prev.learnerId === learnerId && prev.gated !== gated) {
          logger().info('piano.lesson-gate.change', { learnerId, gated, reason: result?.reason ?? null });
        }
        // Its own line, edge-triggered like the gate's: the cap closing is the
        // moment a parent will later want to find, and it is invisible in a
        // `gated` that never moved.
        if (prev.learnerId === learnerId && prev.videos?.locked !== videos.locked) {
          logger().info('piano.lesson-gate.videos', {
            learnerId, locked: videos.locked, reason: videos.reason,
            completedToday: videos.completedToday, cap: videos.cap,
          });
        }
        return {
          learnerId,
          status: 'ready',
          gated,
          videos,
          course: gated ? result.course ?? null : null,
          unit: gated ? result.unit ?? null : null,
          lesson: gated ? result.lesson ?? null : null,
          challenge: gated ? result.challenge ?? null : null,
        };
      });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      // A read that FAILS is as uninformative as one that hangs, and it fails
      // fast: a 500 at t=0.2s used to open every door before a child's finger
      // landed — the 2026-09-01 escape with no pending window at all. So a
      // transient failure keeps the learner pending and lets the poll retry;
      // the ceiling still bounds the wait, so there is no lock-out.
      //
      // A 4xx is not transient. A School-less install answers 404 to every
      // read, and holding those learners for the full ceiling on every pick is
      // exactly the fault the fail-open rule exists to prevent.
      const status = error?.status ?? null;
      const transient = status === null || status >= 500;
      // `timer` non-null means this learner is still inside their pending
      // window with no verdict ever recorded — the only state worth holding.
      const stillPending = ceiling.current?.learnerId === learnerId && ceiling.current.timer !== null;
      const held = transient && stillPending;
      logger().warn('piano.lesson-gate.read-failed', {
        learnerId, status, transient, held, error: error?.message ?? String(error),
      });
      if (held) return;
      settleCeiling(learnerId);
      setSnapshot(open(learnerId, 'error'));
    }
  }, [learnerId, guest, settleCeiling]);

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
      if (ceiling.current?.timer) clearTimeout(ceiling.current.timer);
      ceiling.current = null;
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
  // Derived HERE, once, rather than in each consumer. Two screens
  // re-deriving "is this learner waiting?" from a flat {status, gated} pair is
  // how the menu came to read one field and ignore the other.
  //
  // `!guest` is an explicit statement of the invariant, not a derivation: the
  // two `guest ? 'ready' : 'loading'` expressions in this file already make it
  // impossible for a guest to be `loading`, so no test can currently tell this
  // conjunct from its absence. It is kept because "a guest is never made to
  // wait" is a house rule, and a rule that is only emergent from two other
  // lines is the kind of implicit contract this whole gate exists to stop.
  const pending = !guest && current.status === 'loading';
  // A guest has no School record to be capped against, and `current` for a
  // guest is always an `open(...)` — this is the same explicit statement of the
  // invariant `pending` makes above rather than a derivation.
  const videosLocked = !guest && current.videos?.locked === true;
  return { ...current, pending, videosLocked, refresh };
}

export default usePianoLessonGate;
