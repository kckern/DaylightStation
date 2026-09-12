import { useEffect, useMemo, useRef, useState } from 'react';

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
 * Pure derivation lives in `derivePlayBudget` so it can be tested without a
 * socket or a clock.
 */

export const STALE_AFTER_MS = 45_000;

export function derivePlayBudget({ message, receivedAt, now }) {
  if (!message) return { visible: false, stale: false, mode: 'idle', label: '--:--', ms: 0 };

  const age = now - receivedAt;
  const stale = age > STALE_AFTER_MS;
  // A stale feed freezes the number rather than extrapolating from it.
  const drift = stale ? 0 : age;

  if (message.remainingMs == null) {
    return {
      visible: true, stale, mode: 'elapsed',
      ms: Math.max(0, (message.playedMs ?? 0) + drift),
      label: 'played', warning: message.warning ?? null,
    };
  }
  const left = Math.max(0, message.remainingMs - drift);
  return {
    visible: true, stale, mode: 'remaining', ms: left,
    label: left <= 0 ? "time's up" : 'remaining',
    urgency: left <= 60_000 ? 'crit' : (left <= 180_000 ? 'warn' : null),
    warning: message.warning ?? null,
  };
}

export function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/**
 * @param {Object} opts
 * @param {string|null} opts.deviceId  Null disables the hook entirely.
 * @param {Function} opts.subscribe    (topic, handler) => unsubscribe
 */
export function usePlayBudget({ deviceId, subscribe, tickMs = 1000 }) {
  const [message, setMessage] = useState(null);
  const receivedAt = useRef(0);
  const [, force] = useState(0);

  useEffect(() => {
    if (!deviceId || typeof subscribe !== 'function') return undefined;
    return subscribe(`play-session:${deviceId}`, (payload) => {
      if (payload?.event === 'play.session.ended') { setMessage(null); return; }
      if (payload?.event !== 'play.session.started' && payload?.event !== 'play.session.progress') return;
      receivedAt.current = Date.now();
      setMessage(payload);
    });
  }, [deviceId, subscribe]);

  useEffect(() => {
    if (!message) return undefined;
    const id = setInterval(() => force((n) => n + 1), tickMs);
    return () => clearInterval(id);
  }, [message, tickMs]);

  return useMemo(
    () => derivePlayBudget({ message, receivedAt: receivedAt.current, now: Date.now() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message, Math.floor(Date.now() / tickMs)],
  );
}

export default usePlayBudget;
