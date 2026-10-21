import { useCallback, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { consumePass, refundPass, errorBody, REFUND_WITHIN_MS } from '../../earlyPass.js';

/**
 * One early-pass game, from the first frame of the game to the relock.
 *
 * Lives in `Games()`, above the routes, because the pass outlives the game
 * host: once the game ends the host unmounts, and the screen that says "games
 * lock again" has to know the pass was spent. It also holds the routes open
 * after the pass is consumed, so the access refresh that follows a consume
 * cannot yank a finished game's result screen away mid-sentence.
 *
 * EXACTLY ONE TERMINAL CALL PER PASS. Consume and refund are idempotent on
 * the server, but firing both would let whichever lands first decide. The
 * guard is a ref keyed by pass id, set before the request leaves, so an
 * unmount racing an exit, a crash racing a completion, or a StrictMode double
 * effect all collapse onto the first caller.
 *
 * `playedMs` is measured from the game's own mount (`markStarted`), never
 * from the lock screen or the picker; a pass that never reached a game
 * played 0 ms. The server bounds the refund by its own clock as well, so a
 * refund can be refused (`PASS_REFUND_CLOSED`): that falls back to ONE consume,
 * never a loop. `PASS_NOT_ACTIVE` means the pass already ended elsewhere and
 * is only logged.
 */
export default function useEarlyPassSession({ learnerId, access }) {
  const log = useMemo(() => getLogger().child({ component: 'piano-early-pass' }), []);
  // The pass this screen opened with, and whose it is. Captured the first
  // time the hook reports `via: 'pass'` and kept after the access refresh
  // stops reporting it, which is the point.
  const [held, setHeld] = useState(null);
  if (access?.via === 'pass' && access.pass?.passId && learnerId
    && (held?.passId !== access.pass.passId || held?.learnerId !== learnerId)) {
    setHeld({ passId: access.pass.passId, learnerId, pass: access.pass });
  }
  const [relockedId, setRelockedId] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const settledRef = useRef(null);
  const startedRef = useRef({ passId: null, at: null });
  const leaveTimer = useRef(null);
  const refreshRef = useRef(access?.refresh);
  refreshRef.current = access?.refresh;

  const mine = held && held.learnerId === learnerId ? held : null;
  const relocked = Boolean(mine) && relockedId === mine.passId;
  const holding = Boolean(mine) && !relocked;
  // `held`, not `mine`: a profile switch mid-game unmounts the host, and that
  // game's pass must still be settled for the child who was playing it.
  const heldRef = useRef(held);
  heldRef.current = held;

  const markStarted = useCallback(() => {
    const pass = heldRef.current;
    if (!pass || startedRef.current.passId === pass.passId) return;
    startedRef.current = { passId: pass.passId, at: Date.now() };
  }, []);

  const playedMs = useCallback((passId) => (startedRef.current.passId === passId && startedRef.current.at != null
    ? Math.max(0, Date.now() - startedRef.current.at)
    : 0), []);

  /**
   * End the pass. `mode: 'consume'` always consumes (a board game's durable
   * completion); `'played'` refunds under a minute of play and consumes
   * otherwise. Resolves to 'consumed', 'refunded' or null.
   */
  const settle = useCallback(async (mode, reason) => {
    const pass = heldRef.current;
    if (!pass || settledRef.current === pass.passId) return null;
    settledRef.current = pass.passId;
    const { passId, learnerId: owner } = pass;
    const ms = playedMs(passId);
    const facts = { learnerId: owner, passId, playedMs: ms, reason };
    try {
      if (mode !== 'consume' && ms < REFUND_WITHIN_MS) {
        try {
          const res = await refundPass(owner, passId, ms, reason);
          log.info('piano.early-pass.refunded', { ...facts, refunded: res?.refunded ?? null, duplicate: res?.duplicate === true });
          setOutcome('refunded');
          return 'refunded';
        } catch (error) {
          const code = errorBody(error)?.code ?? null;
          log.warn('piano.early-pass.refused', { ...facts, action: 'refund', status: error?.status ?? null, code });
          // Only a closed window is worth a consume: the pass is still
          // active and the game did happen. Anything else (already ended,
          // network) stays a log line.
          if (code !== 'PASS_REFUND_CLOSED') return null;
        }
      }
      try {
        const res = await consumePass(owner, passId, ms);
        log.info('piano.early-pass.consumed', { ...facts, duplicate: res?.duplicate === true });
        setOutcome('consumed');
        return 'consumed';
      } catch (error) {
        log.warn('piano.early-pass.refused', {
          ...facts, action: 'consume', status: error?.status ?? null, code: errorBody(error)?.code ?? null,
        });
        return null;
      }
    } finally {
      try { refreshRef.current?.(); } catch { /* the relock stands either way */ }
    }
  }, [log, playedMs]);

  /** The game is over: settle by play time and put up the relock screen. */
  const finish = useCallback((reason) => {
    const pass = heldRef.current;
    if (!pass) return;
    setRelockedId(pass.passId);
    settle('played', reason);
  }, [settle]);

  // The host's unmount is deferred one tick and cancelled by a remount, so a
  // StrictMode mount-unmount-mount never spends the pass.
  const leave = useCallback((reason) => {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => finish(reason), 0);
  }, [finish]);
  const stay = useCallback(() => clearTimeout(leaveTimer.current), []);

  return { holding, relocked, outcome, pass: mine?.pass ?? null, markStarted, settle, finish, leave, stay };
}
