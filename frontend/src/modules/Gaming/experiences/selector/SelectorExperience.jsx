import React, { useCallback, useEffect, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { fetchSession, finishSession, sendRuleCommand } from '@gaming/platform/api/sessionClient.js';
import MemberAvatar from '@gaming-ui/MemberAvatar.jsx';
import ShowHeader from '@gaming-ui/ShowHeader.jsx';
import GameButton from '@gaming-ui/GameButton.jsx';
import StageActions from '@gaming-ui/StageActions.jsx';
import './SelectorExperience.scss';

export default function SelectorExperience({ sessionId, onComplete, gamingServices }) {
  const [state, setState] = useState(null); const [definition, setDefinition] = useState(null); const [selectedIds, setSelectedIds] = useState([]); const [error, setError] = useState(null); const [picking, setPicking] = useState(false);
  useEffect(() => { fetchSession(sessionId).then((result) => { setState(result.state); setDefinition(result.definition); setSelectedIds(result.state.candidates.map((candidate) => candidate.id)); }).catch((cause) => setError(cause.message)); }, [sessionId]);
  useWebSocketSubscription('gaming', (message) => { if (message?.kind === 'session-updated' && message.sessionId === sessionId) fetchSession(sessionId).then((result) => setState(result.state)).catch((cause) => setError(cause.message)); }, [sessionId]);
  const pick = useCallback(async () => { if (picking) return; setPicking(true); try { const result = await sendRuleCommand(sessionId, { type: 'selector.pick', candidate_ids: selectedIds }); setState(result.state); gamingServices?.audio?.play('pick'); setError(null); } catch (cause) { setError(cause.message); } finally { setPicking(false); } }, [gamingServices?.audio, picking, selectedIds, sessionId]);
  const done = useCallback(async () => { if (picking) return; setPicking(true); try { const result = await finishSession(sessionId); gamingServices?.audio?.play('win'); onComplete?.(result.result); } catch (cause) { setError(cause.message); setPicking(false); } }, [gamingServices?.audio, onComplete, picking, sessionId]);
  useEffect(() => { const input = (event) => { if (event.detail?.action === 'button.a' && event.detail.phase === 'press') pick(); }; window.addEventListener('gaming:interaction', input); return () => window.removeEventListener('gaming:interaction', input); }, [pick]);
  const toggle = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  return <main className="selector-experience">
    <ShowHeader eyebrow="Prize draw" title={definition?.title || 'Selection'} status={`${selectedIds.length} eligible`} />
    <section className="selector-experience__stage">
      {state?.selected && <section className="selector-winner" key={state.selection_count} role="status"><span className="selector-winner__eyebrow">Selected</span><MemberAvatar member={state.selected} size={130} /><h2>{state.selected.name}</h2></section>}
      {!state?.selected && <div className="selector-experience__prompt"><strong>Who’s in the draw?</strong><span>Select the people who can be picked.</span></div>}
      <div className="selector-candidates" aria-label="Eligible people">{state?.candidates.map((candidate) => {
        const selected = selectedIds.includes(candidate.id);
        return <button key={candidate.id} aria-pressed={selected} onClick={() => toggle(candidate.id)}><span className="selector-candidates__check" aria-hidden="true">{selected ? '✓' : '＋'}</span><MemberAvatar member={candidate} size={56} /><span>{candidate.name}</span></button>;
      })}</div>
      <StageActions><GameButton className="selector-pick" tone="primary" busy={picking} disabled={selectedIds.length === 0} onClick={pick}>{picking ? 'Choosing…' : state?.selected ? 'Pick again' : 'Pick someone'}</GameButton>{state?.selected && <GameButton tone="quiet" disabled={picking} onClick={done}>Done</GameButton>}</StageActions>
      {error && <p className="selector-experience__error" role="alert">{error}</p>}
    </section>
  </main>;
}
