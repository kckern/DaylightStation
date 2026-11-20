import React, { useCallback, useEffect, useRef, useState } from 'react';
import { finishSession, sendRuleCommand } from "../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js";
import { useGamingSession } from "../../../../../../__capabilities/gaming/browser/session-projection.mjs";
import PolyhedralDice from "./PolyhedralDice.jsx";
import { OptionalRendererBoundary } from "../../../../../../__capabilities/gaming/browser/platform/ui/OptionalRendererBoundary.jsx";
import ShowHeader from "../../../../../../__capabilities/gaming/browser/platform/ui/ShowHeader.jsx";
import GameButton from "../../../../../../__capabilities/gaming/browser/platform/ui/GameButton.jsx";
import StageActions from "../../../../../../__capabilities/gaming/browser/platform/ui/StageActions.jsx";
import "./DiceExperience.scss";

export default function DiceExperience({ sessionId, onComplete, gamingServices, reconciledSession }) {
  const { session, error: readError, acceptSession } = useGamingSession(sessionId, reconciledSession);
  const state = session?.state;
  const definition = session?.definition;
  const [notation, setNotation] = useState('1d6'); const [error, setError] = useState(null); const [rolling, setRolling] = useState(false);
  const initializedSession = useRef(null);
  useEffect(() => {
    if (!session || initializedSession.current === sessionId) return;
    initializedSession.current = sessionId;
    setNotation(session.state?.notation || '1d6');
  }, [session, sessionId]);
  const roll = useCallback(async () => { if (rolling) return; setRolling(true); try { const committed = await sendRuleCommand(sessionId, { type: 'dice.roll', notation }); acceptSession(committed); gamingServices?.audio?.play('roll'); setError(null); } catch (cause) { setError(cause.message); } finally { setRolling(false); } }, [acceptSession, gamingServices?.audio, notation, rolling, sessionId]);
  const done = useCallback(async () => {
    if (rolling) return;
    setRolling(true);
    try { const completed = await finishSession(sessionId); gamingServices?.audio?.play('win'); onComplete?.(completed.result); }
    catch (cause) { setError(cause.message); setRolling(false); }
  }, [gamingServices?.audio, onComplete, rolling, sessionId]);
  useEffect(() => { const input = (event) => { if (event.detail?.action === 'button.a' && event.detail.phase === 'press') roll(); }; window.addEventListener('gaming:interaction', input); return () => window.removeEventListener('gaming:interaction', input); }, [roll]);
  const presentationFailure = useCallback((detail) => window.dispatchEvent(new CustomEvent('gaming:presentation-diagnostic', { detail })), []);
  const presets = definition?.presets || [definition?.default_notation || '1d6'];
  return <main className="dice-experience">
    <ShowHeader eyebrow="Tabletop" title={definition?.title || 'Dice'} status={state?.outcome ? `${state.outcome.notation} committed` : 'Choose a roll'} />
    <section className="dice-experience__table">
      <div className="dice-experience__well" key={state?.roll_count || 0}><OptionalRendererBoundary rendererId="three-polyhedron" fallback={<div className="dice-fallback"><span>{state?.outcome?.total || '—'}</span></div>} onFailure={presentationFailure}><PolyhedralDice outcome={state?.outcome} onFailure={presentationFailure} /></OptionalRendererBoundary></div>
      <div className="dice-total" role="status">{state?.outcome ? <><span>Total</span><strong>{state.outcome.total}</strong></> : <><span>Ready</span><strong>—</strong></>}</div>
      <div className="dice-experience__controls">
        <div className="dice-presets" aria-label="Dice presets">{presets.map((preset) => <GameButton tone={notation === preset ? 'primary' : 'default'} key={preset} aria-pressed={notation === preset} onClick={() => setNotation(preset)}>{preset}</GameButton>)}</div>
        <label>Custom roll <input aria-label="Custom dice notation" value={notation} onChange={(event) => setNotation(event.target.value)} /></label>
        <StageActions><GameButton className="dice-roll" tone="primary" busy={rolling} onClick={roll}>{rolling ? 'Committing…' : state?.outcome ? 'Roll again' : 'Roll dice'}</GameButton>{state?.outcome && <GameButton tone="quiet" disabled={rolling} onClick={done}>Done</GameButton>}</StageActions>
      </div>
      {(error || readError) && <p className="dice-experience__error" role="alert">{error || readError.message}</p>}
    </section>
  </main>;
}
