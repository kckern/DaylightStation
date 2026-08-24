import { useCallback, useEffect, useRef, useState } from 'react';
import { chessRuleModule } from '@shared-gaming/rulesets/chess/ruleModule.mjs';
import { createCheckpointedLocalAuthority } from '../../Gaming/platform/authority/createCheckpointedLocalAuthority.js';

const ACTOR = 'piano-player';

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
    if (prior) {
      try { resumed = await authority.resume(prior, { participant_id: ACTOR }); }
      catch { localStorage.removeItem(indexKey); }
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
    if (sessionRef.current) await authorityRef.current.close(sessionRef.current.header.session_id);
    localStorage.removeItem(indexKey);
    return start({ fresh: true, nextSeed });
  }, [indexKey, start]);

  return { session, ready: Boolean(session), move, takeback, reset };
}

export default useChessAuthority;
