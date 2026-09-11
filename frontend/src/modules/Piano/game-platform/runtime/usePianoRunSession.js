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

  // Score and metrics move continuously while a game runs (the side-scroller's
  // score advances every rAF frame; Hero's elapsed_ms every millisecond). They
  // must NOT drive the sync effect: each dispatch appends to the session journal
  // and the coordinator re-reads and replays that whole journal, so a per-frame
  // sync is O(n^2) in frames and its structuredClone eventually exhausts the
  // tab (observed in prod: 90-100% long-task occupancy for the length of a
  // side-scroller run, and `structuredClone ... out of memory` in
  // space-invaders). The rule module keeps only the LATEST sync anyway, so the
  // intermediate commits were overwritten without ever being read.
  //
  // The protocol session records the run's LIFECYCLE. Sync on phase
  // transitions, carrying whatever score and metrics stand at that moment --
  // which is what a terminal sync needs to record the final result.
  //
  // `logger` is held by ref for the same reason: a caller that passes an
  // unmemoized logger would otherwise re-trigger this effect on every render
  // and reintroduce the per-frame dispatch through the back door.
  const latestRef = useRef({ score, metrics, logger });
  latestRef.current = { score, metrics, logger };

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
    // JSON round-trip preserves the previous normalization: undefined-valued
    // metrics (e.g. a game that reports no `distance`) are dropped rather than
    // reaching canonicalStringify as undefined.
    const { score: currentScore, metrics: currentMetrics } = latestRef.current;
    const payload = JSON.parse(JSON.stringify({ phase, score: currentScore, metrics: currentMetrics }));
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
      latestRef.current.logger?.error?.('piano.game.protocol-sync-failed', { gameId, phase, error: error.message });
      return sessionRef.current;
    });
  }, [authority, createSession, definition, gameId, phase]);
}
