/**
 * useGameBudgetMeter — the CLIENT half of the piano game-time budget.
 *
 * Mirrors `coinMeteredGate.js` (frontend/src/modules/Fitness/widgets/EmulatorGame/)
 * as a hook: open a session against the backend, meter locally at 1s
 * resolution while the child is actually present, settle the cumulative
 * total periodically (hold-and-settle — see SETTLE CONTRACT below), and
 * close on depletion or unmount.
 *
 * SETTLE CONTRACT (same as coinMeteredGate): `cumulativeSeconds` sent to
 * settle/close is the CUMULATIVE total seconds consumed since the session
 * opened (a monotonically increasing high-water mark), NOT a per-interval
 * delta. The server charges only newly-crossed whole seconds, so settles
 * are idempotent and safe to retry. ALWAYS send the running total.
 *
 * THE SEEDING FIX (the reason this hook exists as a separate exercise from
 * copy-pasting coinMeteredGate): `coinMeteredGate.js`'s `start()` sets
 * `totalConsumed = 0` unconditionally and never reads a seed back from the
 * server. On the arcade that is mostly harmless — a coin-metered session is
 * short and a mid-session reload is rare. On this kiosk it is not: the
 * tablet reloads many times a day (render watchdog, page-failure reload,
 * connectivity-loss reload, manual kiosk restarts), and because settles are
 * a monotonic high-water mark, a client that restarts its local counter at
 * 0 sends settles the server treats as no-ops until the local counter
 * climbs back past the pre-reload total — i.e. every reload buys the player
 * free, unmetered game time, in exactly the direction this feature exists
 * to prevent. `open`'s response carries `cumulativeSeconds` for exactly
 * this reason; see the seeding comment on `totalSeconds` below.
 *
 * FAIL OPEN: an `open` that throws, or answers `{ enabled: false }`, means
 * games are allowed and unmetered (`'unavailable'` / `'off'`) — never a
 * lockout. Both are logged as `budget.open-failed` so a misconfigured
 * household or a flaky network is visible without ever blocking a child.
 */
import { useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import { activitySignal } from './activitySignal.js';

// Lazy module logger (avoids import-time timing issues; never raw console).
let _log;
const log = () => (_log ||= getLogger().child({ component: 'piano-game-budget' }));

const TICK_MS = 1000;

// Fallbacks only used if the server answer is missing/malformed a field —
// the server is authoritative and normally supplies all three.
const DEFAULT_WARN_AT_SECONDS = 60;
const DEFAULT_SETTLE_INTERVAL_SEC = 60;
const DEFAULT_IDLE_AFTER_SECONDS = 90;

/**
 * Default API adapter: a thin wrapper over DaylightAPI, mirroring
 * `createDefaultCoinApi`'s shape and injectability. Tests never touch the
 * network — they pass a fake `api` instead. The four Task-4 routes:
 *   GET  /users/:userId/game-budget                          -> balance()
 *   POST /users/:userId/game-budget/session                  -> open()
 *   POST /users/:userId/game-budget/session/:sessionId/settle -> settle()
 *   POST /users/:userId/game-budget/session/:sessionId/close  -> close()
 *
 * settle/close bodies MUST be a numeric JSON `{ cumulativeSeconds }` — the
 * route hard-rejects anything else with a 400 (see piano.mjs's
 * `parseCumulativeSeconds`). DaylightAPI always sends `Content-Type:
 * application/json` and JSON.stringifies the body for a non-GET call, which
 * is exactly what the route needs — do NOT reach for `navigator.sendBeacon`
 * on unmount close: a bare beacon defaults to `text/plain`, the route 400s,
 * and the session is never sealed.
 */
export function createDefaultGameBudgetApi() {
  return {
    open: ({ learnerId, deviceId }) =>
      DaylightAPI(`api/v1/piano/users/${learnerId}/game-budget/session`, { deviceId }),
    settle: ({ learnerId, sessionId, cumulativeSeconds }) =>
      DaylightAPI(`api/v1/piano/users/${learnerId}/game-budget/session/${sessionId}/settle`, { cumulativeSeconds }),
    close: ({ learnerId, sessionId, cumulativeSeconds }) =>
      DaylightAPI(`api/v1/piano/users/${learnerId}/game-budget/session/${sessionId}/close`, { cumulativeSeconds }),
    balance: ({ learnerId }) =>
      DaylightAPI(`api/v1/piano/users/${learnerId}/game-budget`),
  };
}

const defaultApi = createDefaultGameBudgetApi();

/**
 * Meter game time for one learner/device pair while `active`.
 *
 * @param {object} opts
 * @param {string} opts.learnerId
 * @param {string} opts.deviceId
 * @param {boolean} opts.active     meter only while true (e.g. inside a match)
 * @param {object} [opts.api]       injectable api adapter (see createDefaultGameBudgetApi)
 * @returns {{
 *   state: 'off'|'opening'|'playing'|'idle-paused'|'warning'|'depleted'|'device-depleted'|'unavailable',
 *   secondsLeft: number,
 *   warn: boolean,
 * }}
 */
export default function useGameBudgetMeter({ learnerId, deviceId, active, api = defaultApi }) {
  const [state, setState] = useState('off');
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!active) {
      setState('off');
      return undefined;
    }

    let cancelled = false;
    let tickHandle = null;

    // --- Per-session bookkeeping. Refs, not state: the tick loop mutates
    // these every second, and re-rendering on every tick would be wasteful
    // (matches coinMeteredGate's plain-object equivalent).
    const sessionId = { current: null };

    // totalSeconds is the cumulative high-water mark reported to (or about
    // to be reported to) the server. NEVER reset to 0 here — see the
    // module-level "THE SEEDING FIX" comment. It is seeded from the
    // server's `cumulativeSeconds` inside openSession(), below.
    const totalSeconds = { current: 0 };
    const secondsLeftLocal = { current: 0 };
    const warnAtSeconds = { current: DEFAULT_WARN_AT_SECONDS };
    const settleIntervalSec = { current: DEFAULT_SETTLE_INTERVAL_SEC };
    const idleAfterSeconds = { current: DEFAULT_IDLE_AFTER_SECONDS };
    const secondsSinceSettle = { current: 0 };
    const idle = { current: false };
    const settling = { current: false };
    const closed = { current: true }; // no open session to close, by default

    const clearTick = () => {
      if (tickHandle != null) {
        clearInterval(tickHandle);
        tickHandle = null;
      }
    };

    // Idempotent: close the session once, with the final cumulative total.
    // This is how the meter closes on unmount (contract #6) — the effect's
    // cleanup function below calls this synchronously; the fetch it fires
    // is not aborted by the unmount because DaylightAPI issues a plain
    // `fetch()` with no AbortController tied to the component lifecycle.
    async function closeSession() {
      clearTick();
      if (closed.current || !sessionId.current) {
        closed.current = true;
        return;
      }
      closed.current = true;
      const cumulativeSeconds = totalSeconds.current;
      try {
        await api.close({ learnerId, sessionId: sessionId.current, cumulativeSeconds });
      } catch (err) {
        log().warn('budget.settle-failed', {
          learnerId, sessionId: sessionId.current, cumulativeSeconds, phase: 'close',
          error: err && err.message,
        });
      }
    }

    // --- Periodic settle (hold-and-settle: send the CUMULATIVE running total).
    async function settle() {
      if (settling.current || cancelled || !sessionId.current) return;
      settling.current = true;
      const cumulativeSeconds = totalSeconds.current;
      try {
        const res = await api.settle({ learnerId, sessionId: sessionId.current, cumulativeSeconds });
        if (cancelled) return;

        if (Number.isFinite(res?.secondsLeft)) {
          secondsLeftLocal.current = Math.max(0, res.secondsLeft);
          setSecondsLeft(secondsLeftLocal.current);
        }

        if (res?.depleted) {
          log().info('budget.depleted', { learnerId, sessionId: sessionId.current, cumulativeSeconds });
          setState('depleted');
          await closeSession();
          return;
        }
        if (res?.deviceDepleted) {
          log().info('budget.device-depleted', { learnerId, sessionId: sessionId.current, cumulativeSeconds });
          setState('device-depleted');
          await closeSession();
          return;
        }

        log().debug('budget.settled', { learnerId, sessionId: sessionId.current, cumulativeSeconds });
        if (!idle.current) {
          const warning = secondsLeftLocal.current <= warnAtSeconds.current;
          setState(warning ? 'warning' : 'playing');
        }
      } catch (err) {
        // Settles are idempotent/retryable — a transient failure is
        // non-fatal; the next interval resends a larger cumulative total.
        log().warn('budget.settle-failed', {
          learnerId, sessionId: sessionId.current, cumulativeSeconds, error: err && err.message,
        });
      } finally {
        settling.current = false;
      }
    }

    // --- Local meter tick: idle pauses the drain entirely (no charge, no
    // countdown) until the next activitySignal bump.
    function tick() {
      const idleNow = Date.now() - activitySignal.lastActivityAt() >= idleAfterSeconds.current * 1000;

      if (idleNow) {
        if (!idle.current) {
          idle.current = true;
          log().info('budget.idle-paused', { learnerId, sessionId: sessionId.current });
          setState('idle-paused');
        }
        return;
      }

      if (idle.current) {
        idle.current = false;
        log().info('budget.idle-resumed', { learnerId, sessionId: sessionId.current });
        // Fall through: this tick counts as active time immediately.
      }

      totalSeconds.current += 1;
      secondsLeftLocal.current = Math.max(0, secondsLeftLocal.current - 1);
      setSecondsLeft(secondsLeftLocal.current);

      const warning = secondsLeftLocal.current <= warnAtSeconds.current;
      setState(warning ? 'warning' : 'playing');

      secondsSinceSettle.current += 1;
      if (secondsSinceSettle.current >= settleIntervalSec.current) {
        secondsSinceSettle.current -= settleIntervalSec.current;
        settle();
      }
    }

    async function openSession() {
      setState('opening');
      try {
        const res = await api.open({ learnerId, deviceId });
        if (cancelled) return;

        if (!res?.enabled) {
          log().warn('budget.open-failed', { learnerId, deviceId, enabled: false });
          setState('off');
          return;
        }

        sessionId.current = res.sessionId;
        closed.current = false;

        // Seed from the server, NEVER zero — see "THE SEEDING FIX" at the
        // top of this file. A client that starts counting from 0 after a
        // mid-match reload makes the reload free, unmetered play, which on
        // this reload-happy kiosk would be the feature's most common
        // failure, in the exact direction it exists to prevent.
        const seed = Number(res.cumulativeSeconds);
        totalSeconds.current = Number.isFinite(seed) && seed >= 0 ? seed : 0;

        secondsLeftLocal.current = Number.isFinite(res.secondsLeft) ? Math.max(0, res.secondsLeft) : 0;
        setSecondsLeft(secondsLeftLocal.current);
        warnAtSeconds.current = Number.isFinite(res.warnAtSeconds) ? res.warnAtSeconds : DEFAULT_WARN_AT_SECONDS;
        settleIntervalSec.current = Number.isFinite(res.settleIntervalSec) && res.settleIntervalSec > 0
          ? res.settleIntervalSec : DEFAULT_SETTLE_INTERVAL_SEC;
        idleAfterSeconds.current = Number.isFinite(res.idleAfterSeconds) && res.idleAfterSeconds > 0
          ? res.idleAfterSeconds : DEFAULT_IDLE_AFTER_SECONDS;
        secondsSinceSettle.current = 0;

        idle.current = Date.now() - activitySignal.lastActivityAt() >= idleAfterSeconds.current * 1000;
        if (idle.current) {
          setState('idle-paused');
        } else {
          setState(secondsLeftLocal.current <= warnAtSeconds.current ? 'warning' : 'playing');
        }

        clearTick();
        tickHandle = setInterval(tick, TICK_MS);
      } catch (err) {
        if (cancelled) return;
        log().warn('budget.open-failed', { learnerId, deviceId, error: err && err.message });
        setState('unavailable');
      }
    }

    openSession();

    return () => {
      cancelled = true;
      closeSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, learnerId, deviceId, api]);

  return { state, secondsLeft, warn: state === 'warning' };
}
