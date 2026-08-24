import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchSession, sendRuleCommand } from '../app/sessionClient.js';

export default function GroupPlayVerifier() {
  const { sessionId } = useParams(); const [session, setSession] = useState(null); const [error, setError] = useState(null); const [complete, setComplete] = useState(false);
  useEffect(() => { let live = true; fetchSession(sessionId).then((value) => { if (live) setSession(value); }).catch((cause) => setError(cause.message)); return () => { live = false; }; }, [sessionId]);
  const confirm = useCallback((accepted) => {
    const actorId = session?.interaction?.viewer_actor_id;
    if (!actorId || !session?.interaction?.can_verify) return;
    sendRuleCommand(sessionId, { type: 'outcome.confirm', accepted }, { actorId }).then(() => setComplete(true)).catch((cause) => setError(cause.message));
  }, [session, sessionId]);
  if (error) return <main className="gp-host gp-host--error"><h1>Verification unavailable</h1><p>{error}</p></main>;
  if (!session) return <main className="gp-host gp-host--loading">Loading verification…</main>;
  if (complete) return <main className="gp-host"><h1>Outcome recorded</h1></main>;
  if (!session.interaction?.can_verify) return <main className="gp-host gp-host--error"><h1>Verifier identity required</h1><p>Open this page while signed in as the configured opponent or verifier.</p></main>;
  return <main className="gp-host"><h1>Confirm the outcome</h1><p>This confirmation—not AI commentary—commits the subjective result.</p><div className="gp-host__actions"><button className="gp-host-btn gp-host-btn--primary" type="button" onClick={() => confirm(true)}>Confirm</button><button className="gp-host-btn gp-host-btn--danger" type="button" onClick={() => confirm(false)}>Reject</button></div></main>;
}
