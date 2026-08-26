import { useCallback, useEffect, useRef, useState } from 'react';
import { connectFourDefinition, connectFourRuleModule } from '@shared-gaming/rulesets/connect-four/index.mjs';
import { createCheckpointedLocalAuthority } from '../../Gaming/platform/authority/createCheckpointedLocalAuthority.js';

const ACTOR = 'piano-player';

export function useConnectFourAuthority({ userId = 'household' } = {}) {
  const authorityRef = useRef(null); const sessionRef = useRef(null); const startPromiseRef = useRef(null); const [state, setState] = useState(null); const indexKey = `gaming:piano-connect-four:active:${userId}`;
  const start = useCallback(async ({ fresh = false } = {}) => {
    const authority = createCheckpointedLocalAuthority({ ruleset: connectFourRuleModule, definition: connectFourDefinition, namespace: 'gaming:piano-connect-four' }); authorityRef.current = authority;
    let session = null; const prior = fresh ? null : localStorage.getItem(indexKey);
    if (prior) { try { session = await authority.resume(prior, { participant_id: ACTOR }); } catch { localStorage.removeItem(indexKey); } }
    if (!session) { session = await authority.create({ ruleset: { id: 'connect-four', version: 1 }, definitionId: 'connect-four-standard', participants: [{ id: ACTOR }], viewer: { participant_id: ACTOR } }); localStorage.setItem(indexKey, session.header.session_id); }
    sessionRef.current = session; setState(session.state); return session;
  }, [indexKey]);
  useEffect(() => { startPromiseRef.current = start(); }, [start]);
  const play = useCallback(async (column) => { const session = sessionRef.current || await startPromiseRef.current; if (!session) return null; const result = await authorityRef.current.dispatch(session.header.session_id, { command_id: `piano:${crypto.randomUUID()}`, actor_id: ACTOR, expected_revision: session.header.revision, logical_time: performance.timeOrigin + performance.now(), command: { type: 'connect-four.play', column } }, { participant_id: ACTOR }); sessionRef.current = result; setState(result.state); return result.state; }, []);
  // Closing a terminal session always throws ("Session … is complete"), so an
  // unguarded close rejects out of "Play again" and leaves a zombie board. See
  // `useChessAuthority.js` for the full account; all three game hooks came from
  // one template and only chess had the guard until 2026-08-26.
  const reset = useCallback(async () => {
    if (sessionRef.current) {
      try { await authorityRef.current.close(sessionRef.current.header.session_id); }
      catch { /* terminal already, or close raced — start fresh regardless */ }
    }
    return start({ fresh: true });
  }, [start]);
  return { state, moves: state?.moves || [], play, reset, authority: authorityRef.current };
}
