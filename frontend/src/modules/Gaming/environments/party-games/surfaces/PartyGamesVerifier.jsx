import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchSession, sendRuleCommand } from '@gaming/platform/api/sessionClient.js';
import GameButton from '@gaming-ui/GameButton.jsx';
import '@gaming-ui/fonts.js';

export default function PartyGamesVerifier() {
  const { sessionId } = useParams(); const [session, setSession] = useState(null); const [error, setError] = useState(null); const [complete, setComplete] = useState(false); const [pending, setPending] = useState(false);
  const refresh = useCallback(() => fetchSession(sessionId).then((value) => { setSession(value); setError(null); }).catch((cause) => setError(cause.message)), [sessionId]);
  useEffect(() => { refresh(); }, [refresh]);
  const confirm = useCallback((accepted) => {
    const actorId = session?.interaction?.viewer_actor_id;
    if (!actorId || !session?.interaction?.can_verify || pending) return;
    setPending(true);
    sendRuleCommand(sessionId, { type: 'outcome.confirm', accepted }, { actorId }).then(() => setComplete(true)).catch((cause) => { setError(cause.message); setPending(false); });
  }, [pending, session, sessionId]);
  if (error) return <main className="gp-host gp-host--error"><h1>Verification unavailable</h1><p>{error}</p><div className="gp-host__row"><GameButton tone="primary" onClick={refresh}>Retry</GameButton><GameButton tone="quiet" onClick={() => window.history.back()}>Go back</GameButton></div></main>;
  if (!session) return <main className="gp-host gp-host--loading" role="status">Loading verification…</main>;
  if (complete) return <main className="gp-host gp-host--loading"><h1>Outcome recorded</h1><p>The TV can continue to the next round.</p></main>;
  if (!session.interaction?.can_verify) return <main className="gp-host gp-host--error"><h1>Sign in as the verifier</h1><p>This round was assigned to another player. Switch to that player’s account, then retry.</p><div className="gp-host__row"><GameButton tone="primary" onClick={refresh}>I’ve switched — retry</GameButton><GameButton tone="quiet" onClick={() => window.history.back()}>Cancel</GameButton></div></main>;
  const performer = (session.header.seats || []).find((seat) => seat.id === session.state.performer_id);
  return <main className="gp-host"><div className="gp-host__phase">Verify the round</div><h1>Confirm what happened</h1><p><strong>{performer?.name || session.state.performer_id}</strong> performed: <strong>{session.state.challenge?.prompt || session.state.challenge?.activity || 'the active challenge'}</strong>.</p><p>Accept only if the recorded result matches what the room saw.</p><div className="gp-host__actions"><GameButton tone="success" busy={pending} onClick={() => confirm(true)}>Accept result</GameButton><GameButton tone="danger" disabled={pending} onClick={() => confirm(false)}>Reject result</GameButton></div></main>;
}
