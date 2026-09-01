import { useCallback, useEffect, useRef, useState } from 'react';
import { checkersDefinition, checkersRuleModule } from '@shared-gaming/rulesets/checkers/index.mjs';
import { createCheckpointedLocalAuthority, isResumableSession } from '../../Gaming/platform/authority/createCheckpointedLocalAuthority.js';

const ACTOR = 'piano-player';

export function useCheckersAuthority({ userId = 'household' } = {}) {
  const authorityRef = useRef(null); const sessionRef = useRef(null); const startPromiseRef = useRef(null); const [state, setState] = useState(null); const indexKey = `gaming:piano-checkers:active:${userId}`;
  const start = useCallback(async ({ fresh = false } = {}) => {
    const authority = createCheckpointedLocalAuthority({ ruleset: checkersRuleModule, definition: checkersDefinition, namespace: 'gaming:piano-checkers' }); authorityRef.current = authority;
    let session = null; const prior = fresh ? null : localStorage.getItem(indexKey);
    // A FINISHED GAME IS NOT A GAME IN PROGRESS — see `isResumableSession` and
    // the identical guard in the other two board games.
    if (prior) {
      try { const resumed = await authority.resume(prior, { participant_id: ACTOR }); if (isResumableSession(resumed)) session = resumed; } catch { /* unreadable — start fresh */ }
      if (!session) localStorage.removeItem(indexKey);
    }
    if (!session) { session = await authority.create({ ruleset: { id: 'checkers', version: 1 }, definitionId: 'checkers-standard', participants: [{ id: ACTOR }], viewer: { participant_id: ACTOR } }); localStorage.setItem(indexKey, session.header.session_id); }
    sessionRef.current = session; setState(session.state); return session;
  }, [indexKey]);
  useEffect(() => { startPromiseRef.current = start(); }, [start]);
  const play = useCallback(async (move) => { const session = sessionRef.current || await startPromiseRef.current; if (!session) return null; const result = await authorityRef.current.dispatch(session.header.session_id, { command_id: `piano:${crypto.randomUUID()}`, actor_id: ACTOR, expected_revision: session.header.revision, logical_time: performance.timeOrigin + performance.now(), command: { type: 'checkers.move', from: move.from, to: move.to } }, { participant_id: ACTOR }); sessionRef.current = result; setState(result.state); return result.state; }, []);
  // A FINISHED SESSION CANNOT BE CLOSED, AND DOES NOT NEED TO BE. The kernel
  // refuses every command on a terminal session — `session.close` included
  // (`runtime.dispatch`: "Session … is complete") — so after a win this close
  // ALWAYS throws. Unguarded it rejected out of "Play again" and, on
  // 2026-08-26, that stray rejection reached the boot trap in index.html and
  // painted "This screen could not start" over a healthy piano kiosk. The trap
  // no longer stays armed past mount, but the rejection was a real bug on its
  // own: it aborted the reset before the fresh start, leaving a zombie board.
  // This is the identical guard `useChessAuthority.js` already carries; the
  // two hooks were written from the same template and only one was fixed.
  const reset = useCallback(async () => {
    if (sessionRef.current) {
      try { await authorityRef.current.close(sessionRef.current.header.session_id); }
      catch { /* terminal already, or close raced — start fresh regardless */ }
    }
    return start({ fresh: true });
  }, [start]);
  return { state, moves: state?.moves || [], play, reset };
}
