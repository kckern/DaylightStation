import React, { useCallback, useEffect, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { fetchSession, sendRuleCommand } from '../../environments/group-play/app/sessionClient.js';
import MemberAvatar from '../../environments/group-play/ui/MemberAvatar.jsx';
import './SelectorExperience.scss';

export default function SelectorExperience({ sessionId }) {
  const [state, setState] = useState(null); const [definition, setDefinition] = useState(null); const [selectedIds, setSelectedIds] = useState([]); const [error, setError] = useState(null);
  useEffect(() => { fetchSession(sessionId).then((result) => { setState(result.state); setDefinition(result.definition); setSelectedIds(result.state.candidates.map((candidate) => candidate.id)); }).catch((cause) => setError(cause.message)); }, [sessionId]);
  useWebSocketSubscription('gaming', (message) => { if (message?.kind === 'session-updated' && message.sessionId === sessionId) fetchSession(sessionId).then((result) => setState(result.state)).catch((cause) => setError(cause.message)); }, [sessionId]);
  const pick = useCallback(async () => { try { const result = await sendRuleCommand(sessionId, { type: 'selector.pick', candidate_ids: selectedIds }); setState(result.state); } catch (cause) { setError(cause.message); } }, [selectedIds, sessionId]);
  useEffect(() => { const input = (event) => { if (event.detail?.action === 'button.a' && event.detail.phase === 'press') pick(); }; window.addEventListener('gaming:interaction', input); return () => window.removeEventListener('gaming:interaction', input); }, [pick]);
  const toggle = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  return <main className="selector-experience"><h1>{definition?.title || 'Selection'}</h1>{state?.selected && <section className="selector-winner"><MemberAvatar member={state.selected} size={150} /><h2>{state.selected.name}</h2></section>}<div className="selector-candidates">{state?.candidates.map((candidate) => <button key={candidate.id} aria-pressed={selectedIds.includes(candidate.id)} onClick={() => toggle(candidate.id)}><MemberAvatar member={candidate} size={64} /><span>{candidate.name}</span></button>)}</div><button className="selector-pick" disabled={selectedIds.length === 0} onClick={pick}>Pick someone</button>{error && <p role="alert">{error}</p>}</main>;
}
