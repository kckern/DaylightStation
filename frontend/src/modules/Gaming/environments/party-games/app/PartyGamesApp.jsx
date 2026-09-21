// Shell root: outer flow (loading → set-picker → team-setup → buzzer-bind →
// playing → results). Mounts the selected game from the registry
// during 'playing'. Game-agnostic — knows nothing about clues or boards.
import React, { useReducer, useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
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
  const [launch] = useState(() => {
    const raw = definitionId || param || appPath || '';
    const queryIndex = raw.indexOf('?');
    const query = new URLSearchParams(queryIndex < 0 ? window.location.search : raw.slice(queryIndex + 1));
    return {
      definition: queryIndex < 0 ? raw : raw.slice(0, queryIndex),
      ...(query.has('autostart') ? { autostart: query.get('autostart') === 'true' } : {}),
      ...(query.has('participants') ? { participants: query.get('participants').split(',').map(id => id.trim()).filter(Boolean) } : {}),
      ...(query.get('history') === 'disabled' ? { historyPolicy: 'disabled' } : {}),
    };
  });
  const requested = launch.definition;
  const activeSessionKey = (id) => `party-games:${id}:${launch.historyPolicy === 'disabled' ? 'test:' : ''}active-session`;
  const requestedDefinition = requested.includes(':') ? requested : null;
  const requestedGame = requestedDefinition ? null : requested;
  // A direct-route mount has no originating menu stack beneath its overlay.
  // Capture that fact before the durable URL effect changes menu launches too.
  const [friendlyPath] = useState(() => /^\/screens?\/[^/]+\/fhe\/charades(?:\/test)?$/.test(window.location.pathname)
    ? window.location.pathname : null);
  const [needsDocumentReturn] = useState(() => Boolean(friendlyPath)
    || /^\/screens?\/[^/]+\/party-games(?:\/|$)/.test(window.location.pathname));
  const [returnTo] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const saved = params.get('return_to');
    if (saved?.startsWith('/')) {
      try {
        const target = new URL(saved, window.location.origin);
        if (target.origin === window.location.origin) return `${target.pathname}${target.search}${target.hash}`;
      } catch { /* An invalid return target falls back to the screen root. */ }
    }
    if (friendlyPath) return friendlyPath.replace(/\/charades(?:\/test)?$/, '');
    return window.location.pathname.replace(/\/party-games(?:\/.*)?$/, '') || '/';
  });
  const restoreLocation = useCallback(() => {
    window.history.replaceState({}, '', returnTo);
  }, [returnTo]);
  const exit = useCallback(() => {
    if (needsDocumentReturn) {
      window.location.replace(returnTo);
      return;
    }
    restoreLocation(); shellExit?.();
  }, [needsDocumentReturn, returnTo, restoreLocation, shellExit]);
  const [attachment, setAttachment] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const diagnosticSessionId = params.get('diagnostic_session');
    const explicitSessionId = params.get('session');
    let savedSessionId = null;
    if (!diagnosticSessionId && !explicitSessionId && requestedDefinition) {
      try { savedSessionId = window.localStorage.getItem(activeSessionKey(requestedDefinition)); }
      catch { savedSessionId = null; }
    }
    return { diagnosticSessionId, sessionId: explicitSessionId || savedSessionId, savedSession: Boolean(savedSessionId) };
  });
  const [flow, dispatchFlow] = useReducer(flowReducer, initialFlowState);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);
  const logger = useMemo(() => getLogger().child({ component: 'party-games' }), []);
  const backActionRef = useRef(null);
  const forwardActionRef = useRef(null);
  const registerBackAction = useCallback((handler) => {
    backActionRef.current = handler;
    return () => { if (backActionRef.current === handler) backActionRef.current = null; };
  }, []);
  const registerForwardAction = useCallback((handler) => {
    forwardActionRef.current = handler;
    return () => { if (forwardActionRef.current === handler) forwardActionRef.current = null; };
  }, []);
  const requestExit = useCallback(() => {
    if (confirmExit) { logger.info('party-games.exit-cancelled', { sessionId: flow.sessionId }); setConfirmExit(false); return; }
    if (backActionRef.current?.()) return;
    if (flow.phase === 'playing' && flow.sessionId) {
      logger.info('party-games.exit-confirmation-opened', { sessionId: flow.sessionId });
      setConfirmExit(true); return;
    }
    exit();
  }, [confirmExit, exit, flow.phase, flow.sessionId, logger]);
  const requestDirectionalBack = useCallback(() => {
    if (flow.phase !== 'playing') return false;
    requestExit(); return true;
  }, [flow.phase, requestExit]);
  const requestAdvance = useCallback(() => {
    if (flow.phase !== 'playing' || confirmExit) return false;
    return forwardActionRef.current?.() ?? false;
  }, [confirmExit, flow.phase]);
  useScopedRemoteControls(rootRef, { onEscape: requestExit, onLeft: requestDirectionalBack, onRight: requestAdvance });
  // Spec §9: WS disconnect badge — buzzer modes degrade to keyboard/inject.
  const { connected } = useWebSocketStatus();

  useEffect(() => {
    const lease = acquireGamepadInputHost(getActionBus());
    return () => lease.release();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBoot({ diagnosticSessionId: attachment.diagnosticSessionId, sessionId: attachment.sessionId })
      .then(({ config, sets, attachedSession }) => {
        if (!cancelled) {
          if (attachedSession) {
            const expectedPolicy = launch.historyPolicy === 'disabled' ? 'disabled' : 'recorded';
            const actualPolicy = attachedSession.state?.charades_history_policy;
            const mismatch = expectedPolicy === 'disabled' ? actualPolicy !== 'disabled' : actualPolicy === 'disabled';
            if (mismatch) {
              throw new Error(`Attached session history policy does not match the ${expectedPolicy} route`);
            }
          }
          if (attachedSession) logger.info('party-games.session-attached', {
            sessionId: attachedSession.header?.session_id,
            resumed: true,
            source: attachment.savedSession ? 'saved' : 'url',
          });
          dispatchFlow({ type: 'BOOT_LOADED', config, sets, attachedSession, requestedDefinition, requestedGame, launch });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (attachment.savedSession && requestedDefinition) {
          logger.warn('party-games.session-resume-missed', { sessionId: attachment.sessionId, definitionId: requestedDefinition, error: err.message });
          try { window.localStorage.removeItem(activeSessionKey(requestedDefinition)); } catch { /* retry without persistence */ }
          setAttachment((value) => ({ ...value, sessionId: null, savedSession: false }));
          return;
        }
        dispatchFlow({ type: 'BOOT_FAILED', error: err.message });
      });
    return () => { cancelled = true; };
  }, [attachment, bootAttempt, requestedDefinition, requestedGame, launch, logger]);

  useEffect(() => {
    if (!flow.definitionId) return;
    const key = activeSessionKey(flow.definitionId);
    try {
      if (flow.phase === 'playing' && flow.sessionId) window.localStorage.setItem(key, flow.sessionId);
      else if (flow.phase === 'results') window.localStorage.removeItem(key);
    } catch { /* URL attachment still preserves refresh recovery when storage is unavailable. */ }
  }, [flow.definitionId, flow.phase, flow.sessionId, launch.historyPolicy]);

  // Reuse the pending creation during StrictMode effect replay; obsolete flows
  // cancel their attachment even if the HTTP response arrives later.
  useEffect(() => {
    if (flow.phase !== 'playing' || flow.sessionId) return;
    const key = JSON.stringify([flow.definitionId, flow.seats, flow.hostMode, flow.setupProfile, launch.historyPolicy]);
    if (!creation.current || creation.current.key !== key) {
      creation.current = { key, promise: createSession({ definitionId: flow.definitionId, seats: flow.seats, hostMode: flow.hostMode, setupProfile: flow.setupProfile, historyPolicy: launch.historyPolicy }) };
    }
    let cancelled = false;
    creation.current.promise.then(session => {
      if (!cancelled) {
        logger.info('party-games.session-attached', { sessionId: session.header.session_id, resumed: false, source: 'created' });
        dispatchFlow({ type: 'SESSION_CREATED', sessionId: session.header.session_id });
      }
    }).catch(error => { if (!cancelled) { creation.current = null; dispatchFlow({ type:'BOOT_FAILED', error:error.message }); } });
    return () => { cancelled = true; };
  }, [flow.phase, flow.sessionId, flow.definitionId, flow.seats, flow.hostMode, flow.setupProfile, launch.historyPolicy, logger]);

  useLayoutEffect(() => {
    if (!flow.definitionId || !['team-setup', 'buzzer-bind', 'playing', 'results'].includes(flow.phase)) return;
    const screenBase = window.location.pathname.match(/^(\/screens?\/[^/]+)/)?.[1];
    const location = new URL(window.location.href);
    if (screenBase) location.pathname = friendlyPath || `${screenBase}/party-games/${flow.definitionId}`;
    location.searchParams.set('return_to', returnTo);
    if (launch.autostart !== undefined) location.searchParams.set('autostart', String(launch.autostart));
    if (launch.participants) location.searchParams.set('participants', launch.participants.join(','));
    location.searchParams.delete('session'); location.searchParams.delete('diagnostic_session');
    if (flow.sessionId) location.searchParams.set(flow.sessionId.startsWith('diagnostic:') ? 'diagnostic_session' : 'session', flow.sessionId);
    window.history.replaceState({}, '', `${location.pathname}${location.search}`);
  }, [flow.definitionId, flow.phase, flow.sessionId, returnTo, launch, friendlyPath]);
  const playAgain = () => {
    creation.current = null;
    try { if (flow.definitionId) window.localStorage.removeItem(activeSessionKey(flow.definitionId)); } catch { /* continue */ }
    restoreLocation(); dispatchFlow({ type:'PLAY_AGAIN' });
  };

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
              onClick={() => dispatchFlow({ type: 'PICK_SET', setId: s.setId, game: s.game, definitionId: s.definitionId, presenterId: s.presenter_id, setup: s.setup, setupProfile: s.setupProfile, launch: s.launch, competition: s.competition, theme: s.theme, input_profile: s.input_profile, lifecycle_capabilities: s.lifecycle_capabilities })}>
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
          <div className="party-games__play" aria-hidden={confirmExit || undefined}>
            <div className="party-games__play-stage"><PartyGamesExperience
              component={Game}
              setId={flow.setId}
              seats={flow.seats}
              sessionId={flow.sessionId}
              buzzerBindings={flow.buzzerBindings}
              config={flow.config}
              registerBackAction={registerBackAction}
              registerForwardAction={registerForwardAction}
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

      {confirmExit && (
        <div className="party-games__confirm-exit" role="dialog" aria-modal="true" aria-labelledby="party-games-leave-title">
          <h2 id="party-games-leave-title">Leave game?</h2>
          <div>
            <GameButton tone="primary" autoFocus onClick={() => setConfirmExit(false)}>Keep playing</GameButton>
            <GameButton tone="danger" onClick={() => { logger.info('party-games.exit-confirmed', { sessionId: flow.sessionId }); setConfirmExit(false); exit(); }}>Leave game</GameButton>
          </div>
        </div>
      )}

      {flow.phase === 'results' && (
        <PartyGamesResults competition={flow.competition} seats={flow.seats} result={flow.result}
          onPlayAgain={playAgain}
          onExit={exit} />
      )}
    </PartyStage></div>
  );
}
