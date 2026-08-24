import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createEphemeralLocalAuthority } from '../../../Gaming/platform/authority/createEphemeralLocalAuthority.js';
import { pianoRunRuleModule } from './pianoRunRuleModule.js';

const ACTOR_ID = 'local-player';

export function usePianoRunSession({ gameId, phase, initialPhase, score = null, metrics = {}, activePhases, terminalPhases, logger }) {
  const activeKey = JSON.stringify(activePhases);
  const terminalKey = JSON.stringify(terminalPhases);
  const definition = useMemo(() => ({
    game_id: gameId,
    initial_phase: initialPhase,
    active_phases: [...new Set(JSON.parse(activeKey))],
    terminal_phases: [...new Set(JSON.parse(terminalKey))],
  }), [activeKey, gameId, initialPhase, terminalKey]);
  const authority = useMemo(() => createEphemeralLocalAuthority({ ruleset: pianoRunRuleModule, definition, actorId: ACTOR_ID }), [definition]);
  const sessionRef = useRef(null);
  const sequenceRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  const payloadKey = JSON.stringify({ phase, score, metrics });

  const createSession = useCallback(() => authority.create({
    ruleset: { id: pianoRunRuleModule.id, version: pianoRunRuleModule.version },
    definitionId: gameId,
    participants: [{ id: ACTOR_ID, role: 'player' }],
    viewer: { participant_id: ACTOR_ID, role: 'player' },
  }), [authority, gameId]);

  useEffect(() => {
    let disposed = false;
    sequenceRef.current = 0;
    sessionRef.current = null;
    const ready = createSession().then((view) => {
      if (!disposed) sessionRef.current = view;
      return view;
    });
    queueRef.current = ready;
    return () => { disposed = true; };
  }, [authority, createSession]);

  useEffect(() => {
    const payload = JSON.parse(payloadKey);
    queueRef.current = queueRef.current.then(async (current) => {
      if (!current) return current;
      // A replay is a new protocol session, not a transition from a completed
      // lifecycle back to active. Native UX state remains owned by Piano.
      if (current.header.status === 'complete' && !definition.terminal_phases.includes(payload.phase)) {
        current = await createSession();
        sequenceRef.current = 0;
      }
      const sequence = sequenceRef.current++;
      const next = await authority.dispatch(current.header.session_id, {
        command_id: `sync:${sequence}`,
        actor_id: ACTOR_ID,
        expected_revision: current.header.revision,
        logical_time: typeof performance === 'undefined' ? Date.now() : performance.timeOrigin + performance.now(),
        correlation_id: current.header.session_id,
        command: { type: 'piano.run.sync', sequence, ...payload },
      }, { participant_id: ACTOR_ID, role: 'player' });
      sessionRef.current = next;
      return next;
    }).catch((error) => {
      logger?.error?.('piano.game.protocol-sync-failed', { gameId, phase, error: error.message });
      return sessionRef.current;
    });
  }, [authority, createSession, definition, gameId, logger, payloadKey, phase]);
}
