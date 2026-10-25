import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWebSocketStatus, useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { fetchSession, sendRuleCommand } from "../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js";
import { printHostPacket, restartJeopardySession } from "../app/sessionClient.js";
import { sendJeopardyCommand } from "../experiences/jeopardy/jeopardyClient.js";
import { HostButton } from "./hostPresenterRegistry.jsx";
import { PARTY_GAMES_HOST_REGISTRY } from "./hostPresenterRegistry.js";
import "./PartyGamesHost.scss";
import "../../../../../__capabilities/gaming/browser/platform/ui/fonts.js";

import { getLogger } from '@/lib/logging/Logger.js';

export default function PartyGamesHost() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const inFlight = useRef(false);
  const logger = getLogger();
  const identity = useRef({ id: sessionId, generation: 0, request: 0, revision: -1 });
  if (identity.current.id !== sessionId) identity.current = { id: sessionId, generation: identity.current.generation + 1, request: 0, revision: -1 };
  const { connected } = useWebSocketStatus();
  const wasConnected = useRef(connected);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [wagerDraft, setWagerDraft] = useState(100);
  const [printStatus, setPrintStatus] = useState(null);

  const follows = useCallback((sourceId, replacementId) => {
    if (!replacementId || replacementId === sourceId || identity.current.id !== sourceId) return;
    // Invalidate work before navigation renders the same unkeyed route component.
    identity.current = { id: replacementId, generation: identity.current.generation + 1, request: 0, revision: -1 };
    inFlight.current = false;
    setSession(null); setError(null); setPending(false); setConfirmRestart(false); setWagerDraft(100); setPrintStatus(null);
    navigate(`/party-games/host/${encodeURIComponent(replacementId)}`, { replace: true });
  }, [navigate]);
  const accept = useCallback((token, value) => {
    if (identity.current !== token || value.header?.session_id !== token.id) return;
    if (value.replacementSessionId) { follows(token.id, value.replacementSessionId); return; }
    const revision = value.header?.revision ?? 0;
    if (revision < token.revision) return;
    token.revision = revision;
    setSession((current) => ({ ...current, ...value })); setError(null);
  }, [follows]);
  const refresh = useCallback(async () => {
    const token = identity.current;
    if (token.id !== sessionId) return;
    const request = ++token.request;
    const revision = token.revision;
    try {
      const value = await fetchSession(sessionId);
      accept(token, value);
    } catch (cause) {
      if (identity.current !== token || request !== token.request || token.revision > revision) return;
      logger.warn('party-games.host.load-failed', { sessionId, message: cause.message }); setError(cause.message);
    }
  }, [sessionId, logger, accept]);
  useEffect(() => {
    inFlight.current = false; setSession(null); setError(null); setPending(false);
    setConfirmRestart(false); setWagerDraft(100); setPrintStatus(null);
    refresh();
  }, [refresh]);
  // Initial connection and reconnect both reconcile recoverable server metadata.
  useEffect(() => { if (connected && !wasConnected.current) refresh(); wasConnected.current = connected; }, [connected, refresh]);
  useWebSocketSubscription('gaming', (message) => {
    if (message?.sessionId !== sessionId) return;
    if (message.kind === 'session-restarted') follows(sessionId, message.replacementSessionId);
    else if (message.kind === 'session-updated') refresh();
  }, [refresh, sessionId, follows]);

  const rulesetId = session?.header?.ruleset?.id;
  const send = useCallback(async (command) => {
    if (inFlight.current) return;
    const token = identity.current;
    inFlight.current = true;
    setPending(true);
    try {
      const result = rulesetId === 'jeopardy' ? await sendJeopardyCommand(sessionId, command) : await sendRuleCommand(sessionId, command);
      accept(token, result);
      logger.info('party-games.host.command-completed', { sessionId, type: command.type });
    } catch (cause) { if (identity.current !== token) return; logger.warn('party-games.host.command-failed', { sessionId, type: command.type, message: cause.message }); setError(cause.message); }
    finally { if (identity.current === token) { inFlight.current = false; setPending(false); } }
  }, [rulesetId, sessionId, logger, accept]);
  const restart = useCallback(async () => {
    if (inFlight.current) return;
    const token = identity.current;
    inFlight.current = true; setPending(true);
    try {
      const replacement = await restartJeopardySession(sessionId);
      if (identity.current !== token) return;
      logger.info('party-games.host.restarted', { sessionId, replacementSessionId: replacement.header.session_id });
      follows(sessionId, replacement.header.session_id);
    } catch (cause) { if (identity.current !== token) return; logger.warn('party-games.host.restart-failed', { sessionId, message: cause.message }); setError(cause.message); }
    finally { if (identity.current === token) { inFlight.current = false; setPending(false); } }
  }, [sessionId, follows, logger]);
  const print = useCallback(async () => { const token = identity.current; setPrintStatus('printing'); try { const result = await printHostPacket(sessionId); if (identity.current === token) setPrintStatus(result.status); } catch { if (identity.current === token) setPrintStatus('failed'); } }, [sessionId]);

  if (error) return <main className="gp-host gp-host--error"><h1>Controller unavailable</h1><p>{error}</p><div className="gp-host__row"><HostButton label="Retry" tone="primary" onClick={refresh} /><HostButton label="Go back" onClick={() => window.history.back()} /></div></main>;
  if (!session) return <main className="gp-host gp-host--loading" role="status">Connecting to the game…</main>;

  const experienceId = session.header.experience?.id;
  const Presenter = PARTY_GAMES_HOST_REGISTRY[experienceId];
  if (!Presenter) return <main className="gp-host gp-host--error"><h1>Controller not available</h1><p>{experienceId || rulesetId} does not provide a Party Games phone controller.</p><HostButton label="Go back" onClick={() => window.history.back()} /></main>;

  return <main className="gp-host" data-phase={session.state?.phase}>{rulesetId === 'jeopardy' && <div className="gp-host__utility">{confirmRestart ? <div><p>Restart game? Scores, questions, and wagers will reset.</p><HostButton label="Confirm restart" tone="danger" pending={pending} onClick={restart} /><HostButton label="Cancel" disabled={pending} onClick={() => setConfirmRestart(false)} /></div> : <HostButton label="Restart game" disabled={pending} onClick={() => setConfirmRestart(true)} />}</div>}<Presenter session={session} definition={session.definition} state={session.state} set={session.state?.set || null} teams={session.header.seats || []} scores={session.state?.scores || {}} send={send} pending={pending} wagerDraft={wagerDraft} setWagerDraft={setWagerDraft} print={print} printStatus={printStatus} /></main>;
}
