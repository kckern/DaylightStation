import { useEffect, useRef, useState } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';

/**
 * Opponent pacing — a platform capability, not a chess one.
 *
 * Three board games on this kiosk (Chess, Connect Four, Checkers) answer the
 * player too fast, in two different shapes that are the same missing concept:
 *
 *   - Connect Four commits the reply the instant the request resolves. No
 *     floor at all — a fast server round trip reads as no opponent present.
 *   - Chess waited `opponentDelayMs` and only THEN sent the request, so
 *     network time was ADDED to the pause. On the kiosk tablet, where WiFi is
 *     known to stall silently, that turned a deliberate four-second brood
 *     into a hang.
 *
 * `thinkTimeFor` is the curve: how long a character at a given rung of their
 * ladder should appear to think, scaled by how many rungs that game's ladder
 * has (21 for chess, 7 for Connect Four and Checkers) and by the config's
 * pace knob. `useOpponentReply` is the wiring: fire the request the moment it
 * is enabled, and commit the answer at `max(elapsed, thinkMs)` — the think
 * time is a FLOOR on the total wait, never an addend on top of it.
 */

export const DEFAULT_THINK_MS = Object.freeze({ floor: 600, ceiling: 4000, jitter: 0.25 });
/** Chess's ladder is the historical default (21 rungs, LADDER_SIZE in @shared-gaming/chess/ladder.mjs). */
const DEFAULT_LEVELS = 21;

let cachedLogger;
function logger() {
  if (!cachedLogger) cachedLogger = getLogger().child({ component: 'opponent-pacing' });
  return cachedLogger;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/** Reads the per-game `opponent.think_ms` block, filling in the house curve for anything missing or invalid. */
export function thinkMsConfig(config) {
  const think = config?.opponent?.think_ms || {};
  return {
    floor: positive(think.floor, DEFAULT_THINK_MS.floor),
    ceiling: positive(think.ceiling, DEFAULT_THINK_MS.ceiling),
    // A jitter above 1 would let a reply arrive before it was asked for.
    jitter: Math.min(1, positive(think.jitter, DEFAULT_THINK_MS.jitter)),
  };
}

/**
 * +/-jitter, deterministic in the seed and the ply.
 *
 * Never Math.random: a game has to replay identically from its seed, and a
 * test has to be able to pin an exact value. Math.imul rather than plain
 * multiplication — the intermediate products exceed 2^53 and would lose their
 * low bits, which are the only ones that vary.
 */
function jitterFactor(seed, ply, jitter) {
  if (!jitter) return 1;
  const mixed = Math.imul((Number(seed) >>> 0) ^ Math.imul(Number(ply) + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  const unit = (mixed % 1000) / 1000;
  return 1 + ((unit * 2) - 1) * jitter;
}

/**
 * How long the opponent takes to answer, at a given rung of a `levels`-rung
 * ladder. A weak opponent answering almost at once and a strong one brooding
 * says what a difficulty label cannot — read without reading.
 *
 * `levels` generalises the old chess-only TOP_LEVEL constant: pass 21 for
 * chess's ladder, 7 for Connect Four's and Checkers'. `level` is read as a
 * 0-based rung index clamped to `[0, levels - 1]`.
 *
 * Returns `null` when `level` is not a finite number — a guest, or a ladder
 * that has not resolved yet — so the caller falls back to its own default
 * rather than this module inventing a strength nobody is actually facing.
 *
 * Pure, and knows nothing about the network. The caller applies the result as
 * a FLOOR on the reply via `useOpponentReply`, never as a delay before the
 * request goes out.
 */
export function thinkTimeFor({
  level, levels = DEFAULT_LEVELS, config = null, seed = 0, ply = 0, pace = 1,
}) {
  // Number.isFinite (no coercion) on purpose: Number(null) is 0 and
  // Number.isFinite(0) is true, which would silently treat "no ladder" as
  // "rung zero" instead of refusing to guess.
  if (typeof level !== 'number' || !Number.isFinite(level)) return null;
  const { floor, ceiling, jitter } = thinkMsConfig(config);
  // A config with the ends the wrong way round should be dull, not inverted.
  const low = Math.min(floor, ceiling);
  const high = Math.max(floor, ceiling);
  const topLevel = Math.max(1, Number(levels) - 1);
  const climbed = Math.min(topLevel, Math.max(0, Math.floor(Number(level)))) / topLevel;
  const base = low + ((high - low) * climbed);
  const scaled = base * jitterFactor(seed, ply, jitter) * positive(pace, 1);
  return Math.max(0, Math.round(scaled));
}

/**
 * Ask first, wait after.
 *
 * Fires `request()` the moment `enabled` (or `resetKey`) turns this effect
 * on, then commits whatever it resolves to at `max(elapsed, thinkMs)` —
 * elapsed being however long the request itself took. Waiting `thinkMs` and
 * THEN asking (the old chess bug) adds the network to the pause; this instead
 * treats `thinkMs` as a floor on the total, so a fast server still reads as a
 * character who took a moment, and a slow network never turns a brood into a
 * hang.
 *
 * `request`, `fallback` and `onReply` are read through refs updated every
 * render rather than being effect dependencies — the caller can pass fresh
 * closures each render (as this codebase's components already do; see
 * PianoChessGame's ref-heavy style) without retriggering the request. Only
 * `enabled` and `resetKey` restart the cycle:
 *
 *   - `enabled` false->true starts a request; true->false (or unmount)
 *     cancels whatever is in flight and discards its reply. This is what
 *     makes a chess takeback safe: rewinding a move changes whose turn it
 *     is, `enabled` flips false, and the pending reply for the position that
 *     no longer exists is thrown away.
 *   - `resetKey` exists for the case `enabled` alone cannot see: a fresh game
 *     that starts back on the opponent's turn (e.g. chess with the player as
 *     Black) never toggles `enabled` across the reset. Pass a value that
 *     changes with the game's identity (a `gameId`) so a restart cancels the
 *     old game's pending reply even though `enabled` stayed `true` throughout.
 *
 * `fallback`, if given, is called only when `request()` itself rejects (a
 * genuine transport failure) — not when it resolves to something falsy. The
 * "no move served, ask the bundled engine instead" case in this codebase's
 * games depends on knowing WHICH happened (for logging "engine: local" vs.
 * the server's own answer), so that merge stays in each caller's `onReply`,
 * exactly as it already did before this hook existed.
 */
/**
 * How long an opponent may take before we stop waiting for it. Generous — a
 * slow server plus a deliberate brood is legitimate — but finite, because an
 * unanswered turn is a dead game the player cannot leave.
 */
export const OPPONENT_STALL_MS = 15000;

export function useOpponentReply({
  enabled, request, fallback = null, thinkMs = 0, onReply, resetKey = null,
  stallMs = OPPONENT_STALL_MS,
}) {
  const requestRef = useRef(request);
  requestRef.current = request;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const thinkMsRef = useRef(thinkMs);
  thinkMsRef.current = thinkMs;
  const [thinking, setThinking] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer = null;
    setThinking(true);
    const startedAt = Date.now();

    let settled = false;
    const settle = (answer) => {
      if (cancelled || settled) return;
      settled = true;
      const elapsed = Date.now() - startedAt;
      const waitMs = Math.max(0, thinkMsRef.current - elapsed);
      timer = setTimeout(() => {
        if (cancelled) return;
        setThinking(false);
        onReplyRef.current?.(answer);
      }, waitMs);
    };

    // request() is called SYNCHRONOUSLY, in this same effect tick, before any
    // timer or microtask exists — not deferred behind a `Promise.resolve()`
    // tick. A test asserting "dispatched before the pause elapses" checks the
    // mock immediately after mount with zero timers advanced and no awaited
    // microtask; a deferred call would still be correct in production but
    // would fail that assertion, so the immediacy is real, not incidental.
    // The try/catch normalises a request() that throws synchronously into the
    // same rejection path as one that returns a rejecting promise.
    let outcome;
    try {
      outcome = Promise.resolve(requestRef.current());
    } catch (error) {
      outcome = Promise.reject(error);
    }
    outcome.then(settle, (error) => {
      logger().warn('opponent-request-failed', { error: error?.message });
      settle(fallbackRef.current ? fallbackRef.current() : null);
    });

    // Guardrail. A request that neither resolves nor rejects leaves the board on
    // the opponent's turn forever, and every key the player then presses is
    // silently discarded — a game that looks alive and cannot be played. Falling
    // back to the local engine is always better than waiting for nothing.
    const stallTimer = stallMs > 0 ? setTimeout(() => {
      if (cancelled || settled) return;
      logger().error('opponent-stalled', { stallMs, thinkMs: thinkMsRef.current });
      settle(fallbackRef.current ? fallbackRef.current() : null);
    }, stallMs) : null;

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (stallTimer) clearTimeout(stallTimer);
      setThinking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, resetKey]);

  return { thinking };
}

export default { DEFAULT_THINK_MS, thinkMsConfig, thinkTimeFor, useOpponentReply };
