// Shell root: outer flow (loading → set-picker → team-setup → buzzer-bind →
// playing → results). Mounts the selected game from the registry
// during 'playing'. Game-agnostic — knows nothing about clues or boards.
import React, { useReducer, useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { useWebSocketStatus } from '@/hooks/useWebSocket.js';
import { flowReducer, initialFlowState } from './flowReducer.js';
import { fetchBoot, createSession } from './sessionClient.js';
import TeamSetup from '../setup/TeamSetup.jsx';
import { useBuzzers } from '../interaction/useBuzzers.js';
import TitleCard from '@gaming-ui/TitleCard.jsx';
import PartyGamesResults from '../ui/PartyGamesResults.jsx';
import { EXPERIENCE_REGISTRY } from './experienceRegistry.js';
import './PartyGamesApp.scss';
import { useScopedRemoteControls } from '@/screen-framework/input/useScopedRemoteControls.js';
import getLogger from '@/lib/logging/Logger.js';
import '@gaming-ui/fonts.js';
import { acquireGamepadInputHost, bindNextGamepadPress } from '../../../../../screen-framework/input/adapters/GamepadAdapter.js';
import { getActionBus } from '../../../../../screen-framework/input/ActionBus.js';
import EffectOverlay from '../effects/EffectOverlay.jsx';
import PartyGamesExperience from './PartyGamesExperience.jsx';
import PartyStage from '@gaming-ui/PartyStage.jsx';
import GameButton from '@gaming-ui/GameButton.jsx';
import CompanionPanel from '@gaming-ui/CompanionPanel.jsx';

// Corner QR the host scans to open the mobile companion for this session.
// Uses the existing /api/v1/qrcode SVG endpoint — no client QR library.
function HostQr({ sessionId }) {
  if (!sessionId) return null;
  const hostUrl = `${window.location.origin}/party-games/host/${sessionId}`;
  return <CompanionPanel title="Host controller" url={hostUrl} size={82} />;
}

function BuzzerBind({ seats, onDone, onBack }) {
  const [bound, setBound] = useState({});
  const { arbiter, startBind, bindingTeamId } = useBuzzers({ teams: seats, onLock: () => {} });
  useEffect(() => {
    const boundByGamepad = (event) => { if (event.detail?.phase === 'press' && event.detail.role_binding) setBound((value) => ({ ...value, [event.detail.role_binding]: true })); };
    window.addEventListener('gaming:interaction', boundByGamepad); return () => window.removeEventListener('gaming:interaction', boundByGamepad);
  }, []);
  // Bindings live in THIS phase's arbiter; onDone hands them to the flow so
  // the game's own arbiter can restore them (they'd be lost otherwise).
  return (
    <div className="party-games__bind">
      <TitleCard title="Buzzer check" subtitle="Bind each team's buzzer, or skip" />
      <p>Choose a team, then press its buzzer. Test each one or continue without hardware.</p>
      <div className="party-games__bind-list">{seats.map((team) => (
        <button key={team.id} type="button"
          className={bindingTeamId === team.id ? 'is-binding' : ''}
          onClick={() => { startBind(team.id); bindNextGamepadPress(team.id); }}>
          {team.name}: {bindingTeamId === team.id ? 'Press your buzzer…' : (bound[team.id] ? 'Bound ✓' : `Buzzer ${team.slot?.replace('slot_', '') || '?'}`)}
        </button>
      ))}</div>
      <div className="party-games__bind-actions"><GameButton tone="quiet" onClick={onBack}>Back</GameButton><GameButton tone="primary" autoFocus onClick={() => onDone(arbiter.bindings())}>Start game</GameButton></div>
    </div>
  );
}

export default function PartyGamesApp({ dismiss, clear, definitionId, param, appPath }) {
  // Mounted as a screen widget (gets `dismiss`) or via /app/:appId (gets `clear`).
  const shellExit = dismiss || clear;
  const rootRef = useRef(null);
  const creation = useRef(null);
  const requested = definitionId || param || appPath || '';
  const requestedDefinition = requested.includes(':') ? requested : null;
  const requestedGame = requestedDefinition ? null : requested;
  const [returnTo] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const saved = params.get('return_to');
    if (saved?.startsWith('/') && !saved.startsWith('//')) return saved;
    return window.location.pathname.replace(/\/party-games(?:\/.*)?$/, '') || '/';
  });
  const restoreLocation = useCallback(() => {
    window.history.replaceState({}, '', returnTo);
  }, [returnTo]);
  const exit = useCallback(() => { restoreLocation(); shellExit?.(); }, [restoreLocation, shellExit]);
  useScopedRemoteControls(rootRef, { onEscape: exit });
  const [attachment] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { diagnosticSessionId: params.get('diagnostic_session'), sessionId: params.get('session') };
  });
  const [flow, dispatchFlow] = useReducer(flowReducer, initialFlowState);
  const [bootAttempt, setBootAttempt] = useState(0);
  // Spec §9: WS disconnect badge — buzzer modes degrade to keyboard/inject.
  const { connected } = useWebSocketStatus();

  useEffect(() => {
    const lease = acquireGamepadInputHost(getActionBus());
    return () => lease.release();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBoot(attachment)
      .then(({ config, sets, attachedSession }) => {
        if (!cancelled) dispatchFlow({ type: 'BOOT_LOADED', config, sets, attachedSession, requestedDefinition, requestedGame });
      })
      .catch((err) => { if (!cancelled) dispatchFlow({ type: 'BOOT_FAILED', error: err.message }); });
    return () => { cancelled = true; };
  }, [attachment, bootAttempt, requestedDefinition, requestedGame]);

  // Reuse the pending creation during StrictMode effect replay; obsolete flows
  // cancel their attachment even if the HTTP response arrives later.
  useEffect(() => {
    if (flow.phase !== 'playing' || flow.sessionId) return;
    const key = JSON.stringify([flow.definitionId, flow.seats, flow.hostMode, flow.setupProfile]);
    if (!creation.current || creation.current.key !== key) {
      creation.current = { key, promise: createSession({ definitionId: flow.definitionId, seats: flow.seats, hostMode: flow.hostMode, setupProfile: flow.setupProfile }) };
    }
    let cancelled = false;
    creation.current.promise.then(session => {
      if (!cancelled) {
        getLogger().child({ component: 'party-games' }).info('party-games.session-attached', { sessionId: session.header.session_id });
        dispatchFlow({ type: 'SESSION_CREATED', sessionId: session.header.session_id });
      }
    }).catch(error => { if (!cancelled) { creation.current = null; dispatchFlow({ type:'BOOT_FAILED', error:error.message }); } });
    return () => { cancelled = true; };
  }, [flow.phase, flow.sessionId, flow.definitionId, flow.seats, flow.hostMode, flow.setupProfile]);

  useLayoutEffect(() => {
    if (!flow.definitionId || !['team-setup', 'buzzer-bind', 'playing', 'results'].includes(flow.phase)) return;
    const screenBase = window.location.pathname.match(/^(\/screens?\/[^/]+)/)?.[1];
    const location = new URL(window.location.href);
    if (screenBase) location.pathname = `${screenBase}/party-games/${flow.definitionId}`;
    location.searchParams.set('return_to', returnTo);
    location.searchParams.delete('session'); location.searchParams.delete('diagnostic_session');
    if (flow.sessionId) location.searchParams.set(flow.sessionId.startsWith('diagnostic:') ? 'diagnostic_session' : 'session', flow.sessionId);
    window.history.replaceState({}, '', `${location.pathname}${location.search}`);
  }, [flow.definitionId, flow.phase, flow.sessionId, returnTo]);
  const playAgain = () => { creation.current = null; restoreLocation(); dispatchFlow({ type:'PLAY_AGAIN' }); };

  const onComplete = useCallback((result) => { dispatchFlow({ type: 'GAME_FINISHED', result }); }, []);

  const Game = EXPERIENCE_REGISTRY[flow.presenterId]?.component;

  return (
    <div ref={rootRef} className="party-games-container"><PartyStage className="party-games" theme={flow.theme?.id} phase={flow.phase}>
      {flow.error && <div className="party-games__error" role="alert"><strong>Party Games needs attention</strong><span>{flow.error}</span><div><GameButton onClick={() => setBootAttempt((value) => value + 1)}>Retry</GameButton><GameButton tone="quiet" onClick={exit}>Exit</GameButton></div></div>}
      {!connected && <div className="party-games__ws-warn" role="status"><strong>Controllers offline</strong><span>Keyboard and on-screen controls still work.</span></div>}

      {flow.phase === 'loading' && <TitleCard title="Party Games" subtitle="Loading…" />}

      {flow.phase === 'set-picker' && (
        <div className="party-games__sets">
          <TitleCard title="Party Games" subtitle="Pick a game" />
          {flow.sets.map((s) => (
            <button key={s.id} type="button" disabled={!s.valid} className="party-games__set-card"
              onClick={() => dispatchFlow({ type: 'PICK_SET', setId: s.setId, game: s.game, definitionId: s.definitionId, presenterId: s.presenter_id, setup: s.setup, setupProfile: s.setupProfile, competition: s.competition, theme: s.theme, input_profile: s.input_profile, lifecycle_capabilities: s.lifecycle_capabilities })}>
              <strong>{s.title}</strong><span>{s.description || (s.setup === 'none' ? 'Jump right in' : s.setup === 'teams' ? 'Team play' : 'Choose your players')}</span>{s.valid && s.roundCount ? <small>{s.roundCount} {s.roundCount === 1 ? 'round' : 'rounds'}</small> : null}{!s.valid && <small>{s.error}</small>}
            </button>
          ))}
          {flow.sets.length === 0 && <p>No mounted party-games experiences are available.</p>}
        </div>
      )}

      {flow.phase === 'team-setup' && (
        <div className="party-games__team-and-host">
          {(flow.setupProfile.host_modes || []).length > 0 && <fieldset className="party-games__host-mode"><legend>Host</legend>{flow.setupProfile.host_modes.map((mode) => <button key={mode} type="button" aria-pressed={flow.hostMode === mode} onClick={() => dispatchFlow({ type: 'SET_HOST_MODE', hostMode: mode })}>{mode.replace('-', ' ')}</button>)}</fieldset>}
          <TeamSetup selectAll={flow.competition === false} config={flow.config} setupKind={flow.setupProfile.kind} onConfirm={(seats) => dispatchFlow({ type: 'PLAYERS_CONFIRMED', seats })} />
        </div>
      )}

      {flow.phase === 'buzzer-bind' && (
        <BuzzerBind seats={flow.seats} onBack={playAgain} onDone={(bindings) => dispatchFlow({ type: 'BIND_DONE', bindings })} />
      )}

      {flow.phase === 'playing' && Game && flow.sessionId && (
        <>
          <div className="party-games__play">
            <div className="party-games__play-stage"><PartyGamesExperience
              component={Game}
              setId={flow.setId}
              seats={flow.seats}
              sessionId={flow.sessionId}
              buzzerBindings={flow.buzzerBindings}
              config={flow.config}
              onComplete={onComplete}
            /></div>
            {flow.competition !== false && <div className="party-games__companion-rail"><HostQr sessionId={flow.sessionId} /></div>}
          </div>
          {flow.competition !== false && <EffectOverlay sessionId={flow.sessionId} />}
        </>
      )}

      {flow.phase === 'playing' && !flow.sessionId && <TitleCard title="Party Games" subtitle="Creating session…" />}

      {flow.phase === 'playing' && flow.sessionId && !Game && (
        <div className="party-games__error" role="alert">Mounted presenter unavailable: {flow.presenterId || 'missing'}</div>
      )}

      {flow.phase === 'results' && (
        <PartyGamesResults competition={flow.competition} seats={flow.seats} result={flow.result}
          onPlayAgain={playAgain}
          onExit={exit} />
      )}
    </PartyStage></div>
  );
}
