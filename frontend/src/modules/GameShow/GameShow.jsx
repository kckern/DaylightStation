// Shell root: outer flow (loading → resume-gate → set-picker → team-setup →
// buzzer-bind → playing → results). Mounts the selected game from the registry
// during 'playing'. Game-agnostic — knows nothing about clues or boards.
import React, { useReducer, useEffect, useState, useCallback } from 'react';
import { useWebSocketStatus } from '@/hooks/useWebSocket.js';
import { flowReducer, initialFlowState } from './shell/flow/flowReducer.js';
import { fetchBoot, createSession } from './shell/session/sessionClient.js';
import TeamSetup from './shell/teams/TeamSetup.jsx';
import { useBuzzers } from './shell/buzzers/useBuzzers.js';
import TitleCard from './shell/components/TitleCard.jsx';
import Results from './games/Jeopardy/Results.jsx';
import { GAME_REGISTRY } from './games/registry.js';
import './GameShow.scss';

// Corner QR the host scans to open the mobile companion for this session.
// Uses the existing /api/v1/qrcode SVG endpoint — no client QR library.
function HostQr({ sessionId }) {
  if (!sessionId) return null;
  const hostUrl = `${window.location.origin}/gameshow/host/${sessionId}`;
  const src = `/api/v1/qrcode?data=${encodeURIComponent(hostUrl)}&size=180`;
  return (
    <div className="gameshow__hostqr" title={hostUrl}>
      <img src={src} alt="Scan to open host controller" width={110} height={110} />
      <span>Host controller</span>
    </div>
  );
}

function BuzzerBind({ teams, onDone }) {
  const [bound, setBound] = useState({});
  const { arbiter, startBind, bindingTeamId } = useBuzzers({ teams, onLock: () => {} });
  // Bindings live in THIS phase's arbiter; onDone hands them to the flow so
  // the game's own arbiter can restore them (they'd be lost otherwise).
  return (
    <div className="gameshow__bind">
      <TitleCard title="Buzzer check" subtitle="Bind each team's buzzer, or skip" />
      {teams.map((team) => (
        <button key={team.id} type="button"
          className={bindingTeamId === team.id ? 'is-binding' : ''}
          onClick={() => { startBind(team.id); setBound((b) => ({ ...b, [team.id]: true })); }}>
          {team.name}: {bindingTeamId === team.id ? 'press your buzzer…' : (bound[team.id] ? 'bound ✓' : `default ${team.slot}`)}
        </button>
      ))}
      <button type="button" autoFocus onClick={() => onDone(arbiter.bindings())}>Start game</button>
    </div>
  );
}

export default function GameShow({ dismiss }) {
  const [flow, dispatchFlow] = useReducer(flowReducer, initialFlowState);
  const [finalScores, setFinalScores] = useState({});
  // Spec §9: WS disconnect badge — buzzer modes degrade to keyboard/inject.
  const { connected } = useWebSocketStatus();

  useEffect(() => {
    let cancelled = false;
    fetchBoot()
      .then(({ config, sets, activeSession }) => {
        if (!cancelled) dispatchFlow({ type: 'BOOT_LOADED', config, sets, activeSession });
      })
      .catch((err) => { if (!cancelled) dispatchFlow({ type: 'BOOT_FAILED', error: err.message }); });
    return () => { cancelled = true; };
  }, []);

  // Create the backend session when play starts without one (fresh game).
  useEffect(() => {
    if (flow.phase !== 'playing' || flow.sessionId) return;
    createSession({ game: flow.game, setId: flow.setId, teams: flow.teams })
      .then((session) => dispatchFlow({ type: 'SESSION_CREATED', sessionId: session.id }))
      .catch(() => { /* non-blocking: game is playable without checkpoints */ });
  }, [flow.phase, flow.sessionId, flow.game, flow.setId, flow.teams]);

  const onFinished = useCallback((scores) => { setFinalScores(scores); dispatchFlow({ type: 'GAME_FINISHED' }); }, []);

  const Game = GAME_REGISTRY[flow.game]?.component;

  return (
    <div className="gameshow" data-phase={flow.phase}>
      {flow.error && <div className="gameshow__error">{flow.error}</div>}
      {!connected && <div className="gameshow__ws-warn" title="Buzzers offline — keyboard still works">⚡</div>}

      {flow.phase === 'loading' && <TitleCard title="Game Show" subtitle="Loading…" />}

      {flow.phase === 'resume-gate' && (
        <div className="gameshow__resume">
          <TitleCard title="Resume game?" subtitle={`${flow.resumeSession.setId} — in progress`} />
          <button type="button" autoFocus onClick={() => dispatchFlow({ type: 'RESUME_ACCEPT' })}>Resume</button>
          <button type="button" onClick={() => dispatchFlow({ type: 'RESUME_DISCARD' })}>Start fresh</button>
        </div>
      )}

      {flow.phase === 'set-picker' && (
        <div className="gameshow__sets">
          <TitleCard title="Game Show" subtitle="Pick a game" />
          {flow.sets.map((s) => (
            <button key={s.id} type="button" disabled={!s.valid}
              onClick={() => dispatchFlow({ type: 'PICK_SET', setId: s.id })}>
              {s.title} {s.valid ? `(${s.roundCount} rounds)` : `— ${s.error}`}
            </button>
          ))}
          {flow.sets.length === 0 && <p>No game sets in data/content/games/jeopardy/</p>}
        </div>
      )}

      {flow.phase === 'team-setup' && (
        <TeamSetup config={flow.config} onConfirm={(teams) => dispatchFlow({ type: 'TEAMS_CONFIRMED', teams })} />
      )}

      {flow.phase === 'buzzer-bind' && (
        <BuzzerBind teams={flow.teams} onDone={(bindings) => dispatchFlow({ type: 'BIND_DONE', bindings })} />
      )}

      {flow.phase === 'playing' && Game && (
        <>
          <Game
            setId={flow.setId}
            teams={flow.teams}
            sessionId={flow.sessionId}
            resumeState={flow.resumeSession?.state || null}
            buzzerBindings={flow.buzzerBindings}
            config={flow.config}
            onFinished={onFinished}
          />
          <HostQr sessionId={flow.sessionId} />
        </>
      )}

      {flow.phase === 'results' && (
        <Results teams={flow.teams} scores={finalScores}
          onPlayAgain={() => dispatchFlow({ type: 'PLAY_AGAIN' })}
          onExit={() => dismiss?.()} />
      )}
    </div>
  );
}
