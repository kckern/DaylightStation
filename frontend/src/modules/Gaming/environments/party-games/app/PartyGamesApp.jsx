// Shell root: outer flow (loading → set-picker → team-setup → buzzer-bind →
// playing → results). Mounts the selected game from the registry
// during 'playing'. Game-agnostic — knows nothing about clues or boards.
import React, { useReducer, useEffect, useState, useCallback } from 'react';
import { useWebSocketStatus } from '@/hooks/useWebSocket.js';
import { flowReducer, initialFlowState } from './flowReducer.js';
import { fetchBoot, createSession } from './sessionClient.js';
import TeamSetup from '../setup/TeamSetup.jsx';
import { useBuzzers } from '../interaction/useBuzzers.js';
import TitleCard from '../../../platform/ui/TitleCard.jsx';
import PartyGamesResults from '../ui/PartyGamesResults.jsx';
import { EXPERIENCE_REGISTRY } from './experienceRegistry.js';
import './PartyGamesApp.scss';
import '../../../platform/ui/fonts.js';
import { acquireGamepadInputHost, bindNextGamepadPress } from '../../../../../screen-framework/input/adapters/GamepadAdapter.js';
import { getActionBus } from '../../../../../screen-framework/input/ActionBus.js';
import EffectOverlay from '../effects/EffectOverlay.jsx';
import PartyGamesExperience from './PartyGamesExperience.jsx';

// Corner QR the host scans to open the mobile companion for this session.
// Uses the existing /api/v1/qrcode SVG endpoint — no client QR library.
function HostQr({ sessionId }) {
  if (!sessionId) return null;
  const hostUrl = `${window.location.origin}/party-games/host/${sessionId}`;
  const src = `/api/v1/qrcode?data=${encodeURIComponent(hostUrl)}&size=180`;
  return (
    <div className="party-games__hostqr" title={hostUrl}>
      <img src={src} alt="Scan to open host controller" width={110} height={110} />
      <span>Host controller</span>
    </div>
  );
}

function BuzzerBind({ teams, onDone }) {
  const [bound, setBound] = useState({});
  const { arbiter, startBind, bindingTeamId } = useBuzzers({ teams, onLock: () => {} });
  useEffect(() => {
    const boundByGamepad = (event) => { if (event.detail?.phase === 'press' && event.detail.role_binding) setBound((value) => ({ ...value, [event.detail.role_binding]: true })); };
    window.addEventListener('gaming:interaction', boundByGamepad); return () => window.removeEventListener('gaming:interaction', boundByGamepad);
  }, []);
  // Bindings live in THIS phase's arbiter; onDone hands them to the flow so
  // the game's own arbiter can restore them (they'd be lost otherwise).
  return (
    <div className="party-games__bind">
      <TitleCard title="Buzzer check" subtitle="Bind each team's buzzer, or skip" />
      {teams.map((team) => (
        <button key={team.id} type="button"
          className={bindingTeamId === team.id ? 'is-binding' : ''}
          onClick={() => { startBind(team.id); bindNextGamepadPress(team.id); }}>
          {team.name}: {bindingTeamId === team.id ? 'Press your buzzer…' : (bound[team.id] ? 'Bound ✓' : `Buzzer ${team.slot?.replace('slot_', '') || '?'}`)}
        </button>
      ))}
      <button type="button" autoFocus onClick={() => onDone(arbiter.bindings())}>Start game</button>
    </div>
  );
}

export default function PartyGamesApp({ game, dismiss, clear }) {
  // Mounted as a screen widget (gets `dismiss`) or via /app/:appId (gets `clear`).
  const exit = dismiss || clear || (() => {});
  const [flow, dispatchFlow] = useReducer(flowReducer, initialFlowState);
  const [finalScores, setFinalScores] = useState({});
  // Spec §9: WS disconnect badge — buzzer modes degrade to keyboard/inject.
  const { connected } = useWebSocketStatus();

  useEffect(() => {
    const lease = acquireGamepadInputHost(getActionBus());
    return () => lease.release();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBoot()
      .then(({ config, sets }) => {
        if (!cancelled) dispatchFlow({ type: 'BOOT_LOADED', config, sets, requestedGame: game });
      })
      .catch((err) => { if (!cancelled) dispatchFlow({ type: 'BOOT_FAILED', error: err.message }); });
    return () => { cancelled = true; };
  }, [game]);

  // Create the backend session when play starts without one (fresh game).
  useEffect(() => {
    if (flow.phase !== 'playing' || flow.sessionId) return;
    createSession({ definitionId: flow.definitionId, teams: flow.teams, hostMode: flow.hostMode, setupProfile: flow.setupProfile })
      .then((session) => dispatchFlow({ type: 'SESSION_CREATED', sessionId: session.header.session_id }))
      .catch((error) => dispatchFlow({ type: 'BOOT_FAILED', error: error.message }));
  }, [flow.phase, flow.sessionId, flow.definitionId, flow.teams, flow.config, flow.hostMode, flow.setupProfile]);

  const onFinished = useCallback((scores) => { setFinalScores(scores); dispatchFlow({ type: 'GAME_FINISHED' }); }, []);

  const Game = EXPERIENCE_REGISTRY[flow.presenterId]?.component;

  return (
    <div className="party-games" data-phase={flow.phase}>
      {flow.error && <div className="party-games__error">{flow.error}</div>}
      {!connected && <div className="party-games__ws-warn" title="Buzzers offline — keyboard still works">⚡</div>}

      {flow.phase === 'loading' && <TitleCard title="Party Games" subtitle="Loading…" />}

      {flow.phase === 'set-picker' && (
        <div className="party-games__sets">
          <TitleCard title="Party Games" subtitle="Pick a game" />
          {flow.sets.map((s) => (
            <button key={s.id} type="button" disabled={!s.valid}
              onClick={() => dispatchFlow({ type: 'PICK_SET', setId: s.setId, game: s.game, definitionId: s.definitionId, presenterId: s.presenter_id, setup: s.setup, setupProfile: s.setupProfile })}>
              {s.title} {s.valid ? (s.roundCount ? `(${s.roundCount} rounds)` : '') : `— ${s.error}`}
            </button>
          ))}
          {flow.sets.length === 0 && <p>No mounted party-games experiences are available.</p>}
        </div>
      )}

      {flow.phase === 'team-setup' && (
        <div className="party-games__team-and-host">
          {(flow.setupProfile.host_modes || []).length > 0 && <fieldset className="party-games__host-mode"><legend>Host</legend>{flow.setupProfile.host_modes.map((mode) => <button key={mode} type="button" aria-pressed={flow.hostMode === mode} onClick={() => dispatchFlow({ type: 'SET_HOST_MODE', hostMode: mode })}>{mode.replace('-', ' ')}</button>)}</fieldset>}
          <TeamSetup config={flow.config} setupKind={flow.setupProfile.kind} onConfirm={(teams) => dispatchFlow({ type: 'TEAMS_CONFIRMED', teams })} />
        </div>
      )}

      {flow.phase === 'buzzer-bind' && (
        <BuzzerBind teams={flow.teams} onDone={(bindings) => dispatchFlow({ type: 'BIND_DONE', bindings })} />
      )}

      {flow.phase === 'playing' && Game && flow.sessionId && (
        <>
          <PartyGamesExperience
            component={Game}
            setId={flow.setId}
            teams={flow.teams}
            sessionId={flow.sessionId}
            buzzerBindings={flow.buzzerBindings}
            config={flow.config}
            onFinished={onFinished}
          />
          <HostQr sessionId={flow.sessionId} />
          <EffectOverlay sessionId={flow.sessionId} />
        </>
      )}

      {flow.phase === 'playing' && !flow.sessionId && <TitleCard title="Party Games" subtitle="Creating session…" />}

      {flow.phase === 'playing' && flow.sessionId && !Game && (
        <div className="party-games__error" role="alert">Mounted presenter unavailable: {flow.presenterId || 'missing'}</div>
      )}

      {flow.phase === 'results' && (
        <PartyGamesResults teams={flow.teams} scores={finalScores}
          onPlayAgain={() => dispatchFlow({ type: 'PLAY_AGAIN' })}
          onExit={exit} />
      )}
    </div>
  );
}
