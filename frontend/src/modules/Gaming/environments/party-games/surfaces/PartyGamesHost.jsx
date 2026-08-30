import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { fetchSession, sendRuleCommand } from '@gaming/platform/api/sessionClient.js';
import { printHostPacket } from '../app/sessionClient.js';
import { sendJeopardyCommand } from '@gaming/experiences/jeopardy/jeopardyClient.js';
import { HostButton } from './hostPresenterRegistry.jsx';
import { PARTY_GAMES_HOST_REGISTRY } from './hostPresenterRegistry.js';
import './PartyGamesHost.scss';
import '@gaming-ui/fonts.js';

export default function PartyGamesHost() {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [wagerDraft, setWagerDraft] = useState(100);
  const [printStatus, setPrintStatus] = useState(null);

  const refresh = useCallback(() => fetchSession(sessionId).then((value) => { setSession(value); setError(null); }).catch((cause) => setError(cause.message)), [sessionId]);
  useEffect(() => { refresh(); }, [refresh]);
  useWebSocketSubscription('gaming', (message) => { if (message?.kind === 'session-updated' && message.sessionId === sessionId) refresh(); }, [refresh, sessionId]);

  const rulesetId = session?.header?.ruleset?.id;
  const send = useCallback(async (command) => {
    if (pending) return;
    setPending(true);
    try {
      const result = rulesetId === 'jeopardy' ? await sendJeopardyCommand(sessionId, command) : await sendRuleCommand(sessionId, command);
      setSession((current) => ({ ...current, ...result })); setError(null);
    } catch (cause) { setError(cause.message); }
    finally { setPending(false); }
  }, [pending, rulesetId, sessionId]);
  const print = useCallback(async () => { setPrintStatus('printing'); try { const result = await printHostPacket(sessionId); setPrintStatus(result.status); } catch { setPrintStatus('failed'); } }, [sessionId]);

  if (error) return <main className="gp-host gp-host--error"><h1>Controller unavailable</h1><p>{error}</p><div className="gp-host__row"><HostButton label="Retry" tone="primary" onClick={refresh} /><HostButton label="Go back" onClick={() => window.history.back()} /></div></main>;
  if (!session) return <main className="gp-host gp-host--loading" role="status">Connecting to the game…</main>;

  const experienceId = session.header.experience?.id;
  const Presenter = PARTY_GAMES_HOST_REGISTRY[experienceId];
  if (!Presenter) return <main className="gp-host gp-host--error"><h1>Controller not available</h1><p>{experienceId || rulesetId} does not provide a Party Games phone controller.</p><HostButton label="Go back" onClick={() => window.history.back()} /></main>;

  return <main className="gp-host" data-phase={session.state?.phase}><Presenter session={session} definition={session.definition} state={session.state} set={session.state?.set || null} teams={session.header.seats || []} scores={session.state?.scores || {}} send={send} pending={pending} wagerDraft={wagerDraft} setWagerDraft={setWagerDraft} print={print} printStatus={printStatus} /></main>;
}
