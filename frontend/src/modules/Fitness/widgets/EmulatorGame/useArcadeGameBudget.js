import { useEffect, useMemo, useRef, useState } from 'react';
import { ARCADE_SESSION_EVENTS } from '@shared-contracts/media/topics.mjs';
import getLogger from '../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'arcade-clock' });
  return _logger;
}

/** Legacy `play.session.*` names still map across (see ARCADE_SESSION_EVENTS). */
export function arcadeSessionEvent(payload) {
  return String(payload?.event ?? '').replace(/^play\.session\./, 'arcade.session.');
}

/**
 * Follows this surface's own play session so the console can show its own
 * countdown.
 *
 * The in-browser emulator must NEVER arm a device overlay — that surface exists
 * because the console emulator is a foreign app we cannot draw inside, which is
 * not a problem here. This draws in its own React tree instead.
 *
 * Two honesty rules, the same ones the device overlay follows:
 *
 *  - With no budget granted it reports ELAPSED play rather than inventing a
 *    countdown out of nothing.
 *  - If the feed goes quiet it reports `stale` and stops advancing. A clock that
 *    keeps ticking on data it no longer has is a lie told confidently, and it
 *    would tell a child they have time they may not.
 *
 * Pure derivation lives in `deriveArcadeGameBudget` so it can be tested without a
 * socket or a clock.
 */

export const STALE_AFTER_MS = 45_000;
export const MAX_DRIFT_MS = 25_000;

export function deriveArcadeGameBudget({ message, receivedAt, now }) {
  const systemLabel = message?.systemLabel ?? null;
  const overlayConfig = message?.overlay ?? null;
  if (!message) return { visible: false, stale: false, mode: 'idle', label: '--:--', ms: 0, systemLabel, overlayConfig };

  const age = now - receivedAt;
  const stale = age > STALE_AFTER_MS;
  // A stale feed freezes the number rather than extrapolating from it.
  // Only PLAYING advances between messages, and never further than one missed
  // report or two — a silent backend is not extrapolated into time played.
  const frozen = message.state === 'paused' || message.state === 'unknown';
  const drift = stale || frozen ? 0 : Math.min(age, MAX_DRIFT_MS);

  if (message.remainingMs == null) {
    return {
      visible: true, stale, mode: 'elapsed',
      ms: Math.max(0, (message.playedMs ?? 0) + drift),
      label: message.state === 'paused' ? 'paused' : 'played', warning: message.warning ?? null,
      systemLabel, overlayConfig,
    };
  }
  const left = Math.max(0, message.remainingMs - drift);
  return {
    visible: true, stale, mode: 'remaining', ms: left,
    label: left <= 0 ? "time's up" : 'remaining',
    urgency: left <= 60_000 ? 'crit' : (left <= 180_000 ? 'warn' : null),
    warning: message.warning ?? null,
    systemLabel, overlayConfig,
  };
}

export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n) => `${n < 10 ? '0' : ''}${n}`;
  return hours ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/**
 * @param {Object} opts
 * @param {string|null} opts.deviceId  Null disables the hook entirely.
 * @param {Function} opts.subscribe    (topic, handler) => unsubscribe
 */
export function useArcadeGameBudget({ deviceId, subscribe, tickMs = 1000 }) {
  const [message, setMessage] = useState(null);
  const receivedAt = useRef(0);
  const [, force] = useState(0);

  useEffect(() => {
    if (!deviceId || typeof subscribe !== 'function') return undefined;
    let shownSession = null;
    const unknown = new Set();
    logger().info('arcade.clock.subscribed', { deviceId });
    const unsubscribe = subscribe(`arcade-session:${deviceId}`, (payload) => {
      const event = arcadeSessionEvent(payload);
      if (event === ARCADE_SESSION_EVENTS.ENDED) {
        logger().info('arcade.clock.ended', { deviceId, sessionId: payload?.sessionId ?? null, playedMs: payload?.playedMs ?? null, reason: payload?.reason ?? null });
        shownSession = null;
        setMessage(null);
        return;
      }
      if (event !== ARCADE_SESSION_EVENTS.STARTED && event !== ARCADE_SESSION_EVENTS.PROGRESS) {
        // The clock going silent for a week because of a renamed event is what
        // this line exists to prevent.
        if (payload?.event && !unknown.has(payload.event)) {
          unknown.add(payload.event);
          logger().warn('arcade.clock.unknown-event', { deviceId, event: payload.event });
        }
        return;
      }
      receivedAt.current = Date.now();
      if (shownSession !== payload.sessionId) {
        shownSession = payload.sessionId;
        logger().info('arcade.clock.first-message', {
          deviceId, sessionId: payload.sessionId ?? null, event: payload.event, replay: !!payload.replay,
          state: payload.state ?? null, playedMs: payload.playedMs ?? null,
          remainingMs: payload.remainingMs ?? null, fields: payload.overlay?.fields ?? null,
        });
      }
      setMessage(payload);
    });
    return () => {
      logger().info('arcade.clock.unsubscribed', { deviceId });
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [deviceId, subscribe]);

  useEffect(() => {
    if (!message) return undefined;
    const id = setInterval(() => force((n) => n + 1), tickMs);
    return () => clearInterval(id);
  }, [message, tickMs]);

  const budget = useMemo(
    () => deriveArcadeGameBudget({ message, receivedAt: receivedAt.current, now: Date.now() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message, Math.floor(Date.now() / tickMs)],
  );

  // Going stale and recovering are the moments a clock stops telling the truth
  // and starts again — both belong in the store.
  const wasStale = useRef(false);
  useEffect(() => {
    if (budget.stale === wasStale.current) return;
    wasStale.current = budget.stale;
    logger()[budget.stale ? 'warn' : 'info'](budget.stale ? 'arcade.clock.stale' : 'arcade.clock.fresh', {
      deviceId, sessionId: message?.sessionId ?? null, shownMs: budget.ms,
    });
  }, [budget.stale, budget.ms, deviceId, message?.sessionId]);

  return budget;
}

export default useArcadeGameBudget;
