import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
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
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [wagerDraft, setWagerDraft] = useState(100);
  const [printStatus, setPrintStatus] = useState(null);

  const refresh = useCallback(() => fetchSession(sessionId).then((value) => { setSession(value); setError(null); logger.info('party-games.host.loaded', { sessionId }); }).catch((cause) => { logger.warn('party-games.host.load-failed', { sessionId, message: cause.message }); setError(cause.message); }), [sessionId, logger]);
  useEffect(() => { refresh(); }, [refresh]);
  useWebSocketSubscription('gaming', (message) => { if (message?.kind === 'session-updated' && message.sessionId === sessionId) refresh(); }, [refresh, sessionId]);

  const rulesetId = session?.header?.ruleset?.id;
  const send = useCallback(async (command) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const result = rulesetId === 'jeopardy' ? await sendJeopardyCommand(sessionId, command) : await sendRuleCommand(sessionId, command);
      setSession((current) => ({ ...current, ...result })); setError(null);
      logger.info('party-games.host.command-completed', { sessionId, type: command.type });
    } catch (cause) { logger.warn('party-games.host.command-failed', { sessionId, type: command.type, message: cause.message }); setError(cause.message); }
    finally { inFlight.current = false; setPending(false); }
  }, [rulesetId, sessionId, logger]);
  const restart = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true);
    try {
      const replacement = await restartJeopardySession(sessionId);
      setSession(replacement); setError(null); setConfirmRestart(false); setWagerDraft(100); setPrintStatus(null);
      logger.info('party-games.host.restarted', { sessionId, replacementSessionId: replacement.header.session_id });
      navigate(`/party-games/host/${encodeURIComponent(replacement.header.session_id)}`, { replace: true });
    } catch (cause) { logger.warn('party-games.host.restart-failed', { sessionId, message: cause.message }); setError(cause.message); }
    finally { inFlight.current = false; setPending(false); }
  }, [sessionId, navigate, logger]);
  const print = useCallback(async () => { setPrintStatus('printing'); try { const result = await printHostPacket(sessionId); setPrintStatus(result.status); } catch { setPrintStatus('failed'); } }, [sessionId]);

  if (error) return <main className="gp-host gp-host--error"><h1>Controller unavailable</h1><p>{error}</p><div className="gp-host__row"><HostButton label="Retry" tone="primary" onClick={refresh} /><HostButton label="Go back" onClick={() => window.history.back()} /></div></main>;
  if (!session) return <main className="gp-host gp-host--loading" role="status">Connecting to the game…</main>;

  const experienceId = session.header.experience?.id;
  const Presenter = PARTY_GAMES_HOST_REGISTRY[experienceId];
  if (!Presenter) return <main className="gp-host gp-host--error"><h1>Controller not available</h1><p>{experienceId || rulesetId} does not provide a Party Games phone controller.</p><HostButton label="Go back" onClick={() => window.history.back()} /></main>;

  return <main className="gp-host" data-phase={session.state?.phase}>{rulesetId === 'jeopardy' && <div className="gp-host__utility">{confirmRestart ? <div><p>Restart game? Scores, questions, and wagers will reset.</p><HostButton label="Confirm restart" tone="danger" pending={pending} onClick={restart} /><HostButton label="Cancel" disabled={pending} onClick={() => setConfirmRestart(false)} /></div> : <HostButton label="Restart game" disabled={pending} onClick={() => setConfirmRestart(true)} />}</div>}<Presenter session={session} definition={session.definition} state={session.state} set={session.state?.set || null} teams={session.header.seats || []} scores={session.state?.scores || {}} send={send} pending={pending} wagerDraft={wagerDraft} setWagerDraft={setWagerDraft} print={print} printStatus={printStatus} /></main>;
}
