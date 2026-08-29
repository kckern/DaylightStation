import React, { useCallback, useEffect, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { fetchSession, sendRuleCommand } from '../../platform/api/sessionClient.js';
import PolyhedralDice from './PolyhedralDice.jsx';
import { OptionalRendererBoundary } from '../../platform/ui/OptionalRendererBoundary.jsx';
import './DiceExperience.scss';

export default function DiceExperience({ sessionId }) {
  const [state, setState] = useState(null); const [definition, setDefinition] = useState(null); const [notation, setNotation] = useState('1d6'); const [error, setError] = useState(null); const [rolling, setRolling] = useState(false);
  useEffect(() => { fetchSession(sessionId).then((result) => { setState(result.state); setDefinition(result.definition); setNotation(result.state.notation); }).catch((cause) => setError(cause.message)); }, [sessionId]);
  useWebSocketSubscription('gaming', (message) => { if (message?.kind === 'session-updated' && message.sessionId === sessionId) fetchSession(sessionId).then((result) => setState(result.state)).catch((cause) => setError(cause.message)); }, [sessionId]);
  const roll = useCallback(async () => { if (rolling) return; setRolling(true); try { const committed = await sendRuleCommand(sessionId, { type: 'dice.roll', notation }); setState(committed.state); setError(null); } catch (cause) { setError(cause.message); } finally { setRolling(false); } }, [notation, rolling, sessionId]);
  useEffect(() => { const input = (event) => { if (event.detail?.action === 'button.a' && event.detail.phase === 'press') roll(); }; window.addEventListener('gaming:interaction', input); return () => window.removeEventListener('gaming:interaction', input); }, [roll]);
  const presentationFailure = useCallback((detail) => window.dispatchEvent(new CustomEvent('gaming:presentation-diagnostic', { detail })), []);
  const presets = definition?.presets || [definition?.default_notation || '1d6'];
  return <main className="dice-experience"><h1>{definition?.title || 'Dice'}</h1><OptionalRendererBoundary rendererId="three-polyhedron" fallback={<div className="dice-fallback"><span>{state?.outcome?.total || '—'}</span></div>} onFailure={presentationFailure}><PolyhedralDice outcome={state?.outcome} onFailure={presentationFailure} /></OptionalRendererBoundary><div className="dice-total">{state?.outcome ? `Total ${state.outcome.total}` : 'Ready'}</div><div className="dice-presets">{presets.map((preset) => <button key={preset} aria-pressed={notation === preset} onClick={() => setNotation(preset)}>{preset}</button>)}</div><label>Custom roll <input value={notation} onChange={(event) => setNotation(event.target.value)} /></label><button className="dice-roll" disabled={rolling} onClick={roll}>{rolling ? 'Committing…' : 'Roll'}</button>{error && <p role="alert">{error}</p>}</main>;
}
