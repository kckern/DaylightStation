import { useCallback, useEffect, useRef, useState } from 'react';
import { chessRuleModule } from '@shared-gaming/rulesets/chess/ruleModule.mjs';
import { createCheckpointedLocalAuthority, isResumableSession } from '../../Gaming/platform/authority/createCheckpointedLocalAuthority.js';
import getLogger from '../../../lib/logging/Logger.js';

const ACTOR = 'piano-player';

/**
 * How long an unfinished game stays resumable after its last move.
 *
 * The saved session is a reload's safety net — the tablet reloads itself many
 * times a day — not a save slot. It lives in ONE screen's localStorage, so a
 * game left on the office display waits there, invisible from the tablet,
 * until the same player next opens chess on that screen. On 2026-09-27 that
 * was a month: a child who had just left a game on the tablet was handed a
 * different, 30-day-old board, already filed as abandoned, with 739 hours on
 * the clock. Six hours covers an afternoon away; it does not cover tomorrow.
 */
export const RESUME_MAX_IDLE_MS = 6 * 60 * 60 * 1000;

let cachedLogger;
function logger() {
  if (!cachedLogger) cachedLogger = getLogger().child({ component: 'chess-authority' });
  return cachedLogger;
}

/** Ms since the last move landed, or null for a board nobody has moved on. */
export function sessionIdleMs(session, now = Date.now()) {
  const last = Number(session?.state?.history?.at?.(-1)?.logical_time);
  return Number.isFinite(last) ? Math.max(0, now - last) : null;
}

export function useChessAuthority({ userId = 'household', initialFen, seed } = {}) {
  const authorityRef = useRef(null);
  const sessionRef = useRef(null);
  const startPromiseRef = useRef(null);
  const [session, setSession] = useState(null);
  const definition = { id: 'chess-standard', variant: 'standard', initial_fen: initialFen };
  const definitionKey = String(initialFen);
  const indexKey = `gaming:piano-chess:active:${userId}`;

  const start = useCallback(async ({ fresh = false, nextSeed = seed } = {}) => {
    const authority = createCheckpointedLocalAuthority({
      ruleset: chessRuleModule,
      definition,
      namespace: 'gaming:piano-chess',
    });
    authorityRef.current = authority;
    let resumed = null;
    const prior = fresh ? null : localStorage.getItem(indexKey);
    // A FINISHED GAME IS NOT A GAME IN PROGRESS — see `isResumableSession` and
    // the identical guard in the other two board games.
    if (prior) {
      try {
        const priorSession = await authority.resume(prior, { participant_id: ACTOR });
        const idleMs = sessionIdleMs(priorSession);
        if (idleMs != null && idleMs > RESUME_MAX_IDLE_MS) {
          logger().info('chess.resume.stale-discarded', {
            userId, idleMs, plies: priorSession?.state?.history?.length ?? null,
          });
        } else if (isResumableSession(priorSession)) {
          resumed = priorSession;
        }
      } catch { /* unreadable — start fresh */ }
      if (!resumed) localStorage.removeItem(indexKey);
    }
    if (!resumed) {
      resumed = await authority.create({
        ruleset: { id: 'chess', version: 1 },
        definitionId: 'chess-standard',
        participants: [{ id: ACTOR }],
        viewer: { participant_id: ACTOR },
        seed: Number(nextSeed) >>> 0,
      });
      localStorage.setItem(indexKey, resumed.header.session_id);
    }
    sessionRef.current = resumed;
    setSession(resumed);
    return resumed;
  // definitionKey captures the authored initial position without depending on
  // a freshly allocated definition object. The seed is run setup, not definition.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionKey, indexKey]);

  useEffect(() => { startPromiseRef.current = start(); }, [start]);

  const dispatch = useCallback(async (command) => {
    const current = sessionRef.current || await startPromiseRef.current;
    if (!current) throw new Error('Chess authority is unavailable');
    const result = await authorityRef.current.dispatch(current.header.session_id, {
      command_id: `piano:${crypto.randomUUID()}`,
      actor_id: ACTOR,
      expected_revision: current.header.revision,
      logical_time: Date.now(),
      command,
    }, { participant_id: ACTOR });
    sessionRef.current = result;
    setSession(result);
    return result;
  }, []);

  const move = useCallback((value) => dispatch({
    type: 'chess.move', from: value.from, to: value.to, promotion: value.promotion || 'q',
  }), [dispatch]);
  const takeback = useCallback((plies) => dispatch({ type: 'chess.takeback', plies }), [dispatch]);
  const reset = useCallback(async (nextSeed) => {
    // A FINISHED SESSION CANNOT BE CLOSED, AND DOES NOT NEED TO BE. The kernel
    // refuses every command on a terminal session — `session.close` included
    // (`runtime.dispatch`: "Session … is complete") — so after a checkmate this
    // close ALWAYS throws. Left unhandled it aborted the reset before the fresh
    // start: "Play again" swapped the board but never minted a new authority
    // session, and every move in the new game died `authority-move-failed:
    // Session is complete` — a zombie board until remount. Complete is already
    // closed in every sense that matters; a genuinely live session still gets
    // its close, and a close that fails for any reason must not cost the
    // player their next game.
    if (sessionRef.current) {
      try { await authorityRef.current.close(sessionRef.current.header.session_id); }
      catch { /* terminal already, or close raced — start fresh regardless */ }
    }
    localStorage.removeItem(indexKey);
    return start({ fresh: true, nextSeed });
  }, [indexKey, start]);

  return { session, ready: Boolean(session), move, takeback, reset };
}

export default useChessAuthority;
