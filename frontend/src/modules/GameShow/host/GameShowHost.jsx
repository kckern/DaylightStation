// Mobile host companion. A phone the host holds to drive the game running on
// the TV: it mirrors live state over WS (kind:'state') and sends commands
// (POST → kind:'command') that the TV's Jeopardy orchestrator applies. The TV
// stays authoritative; this is a thin, phase-aware remote.
import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { fetchSession, fetchSet, sendCommand } from '../shell/session/sessionClient.js';
import { clampWager } from '../shell/components/WagerPanel.jsx';
import { hostButtons } from './hostView.js';
import './GameShowHost.scss';

function Btn({ label, tone = 'plain', onClick }) {
  return <button type="button" className={`gsh-btn gsh-btn--${tone}`} onClick={onClick}>{label}</button>;
}

export default function GameShowHost() {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [set, setSet] = useState(null);
  const [snap, setSnap] = useState(null); // { jeopardy, scores }
  const [error, setError] = useState(null);
  const [wagerDraft, setWagerDraft] = useState(100);

  useEffect(() => {
    let cancelled = false;
    fetchSession(sessionId)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        return fetchSet(s.game, s.setId).then((content) => { if (!cancelled) setSet(content); });
      })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [sessionId]);

  useWebSocketSubscription('gameshow', (msg) => {
    if (msg?.kind === 'state' && msg.sessionId === sessionId && msg.snapshot) setSnap(msg.snapshot);
  }, [sessionId]);

  const send = useCallback((command) => { sendCommand(sessionId, command); }, [sessionId]);

  if (error) return <div className="gsh gsh--error">{error}</div>;
  if (!session || !set) return <div className="gsh gsh--loading">Connecting to game…</div>;

  const teams = session.teams || [];
  const teamName = (id) => teams.find((t) => t.id === id)?.name || id;
  const j = snap?.jeopardy;
  const scores = snap?.scores || {};

  if (!j) return <div className="gsh gsh--loading">Waiting for the TV… (session {sessionId})</div>;

  const round = set.rounds[j.roundIndex];
  const buttons = hostButtons(j);

  return (
    <div className="gsh" data-phase={j.phase}>
      <header className="gsh__scores">
        {teams.map((t) => (
          <span key={t.id} className="gsh__score" style={{ '--team-color': t.color || '#888' }}>
            <b>{t.name}</b> {(scores[t.id] ?? 0).toLocaleString()}
          </span>
        ))}
      </header>

      <div className="gsh__phase">{j.phase.replace(/-/g, ' ')}</div>

      {/* Board — direct tile picker */}
      {j.phase === 'board' && round && (
        <div className="gsh__board" style={{ '--cats': round.categories.length }}>
          {round.categories.map((cat, c) => (
            <div key={c} className="gsh__col">
              <div className="gsh__cat">{cat.name}</div>
              {cat.clues.map((clue, r) => {
                const used = j.used[`${j.roundIndex}:${c}:${r}`];
                return (
                  <button key={r} type="button" disabled={used}
                    className={`gsh__tile${used ? ' is-used' : ''}`}
                    onClick={() => send({ type: 'SELECT_AT', cat: c, row: r })}>
                    {used ? '' : `$${clue.value * round.multiplier}`}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Clue / judging — show the answer so the host can judge */}
      {(j.phase === 'clue' || j.phase === 'judging') && j.active && (
        <div className="gsh__clue">
          <div className="gsh__cluetext">{j.active.clue.clue}</div>
          <div className="gsh__answer">Answer: {j.active.clue.answer}</div>
          {/* No-hardware path: designate who answers */}
          {j.phase === 'clue' && !j.isDailyDouble && !j.revealed && round?.mode !== 'turns' && (
            <div className="gsh__row">
              {teams.filter((t) => !j.attempted.includes(t.id)).map((t) => (
                <Btn key={t.id} label={`${t.name} answers`} tone="team"
                  onClick={() => send({ type: 'BUZZ', teamId: t.id })} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wager (Daily Double) */}
      {j.phase === 'wager' && (
        <WagerControl
          label={`${teamName(j.answeringTeamId)} — wager`}
          bounds={{ score: Math.max(scores[j.answeringTeamId] ?? 0, 0), roundMax: roundMax(round) }}
          value={wagerDraft} onChange={setWagerDraft}
          onConfirm={(amount) => { send({ type: 'SET_WAGER', amount }); setWagerDraft(100); }}
        />
      )}

      {/* Final wager — one team at a time */}
      {j.phase === 'final-wager' && (() => {
        const pending = teams.find((t) => j.finalWagers[t.id] == null);
        if (!pending) return null;
        return (
          <WagerControl
            label={`${pending.name} — final wager`}
            bounds={{ score: Math.max(scores[pending.id] ?? 0, 0), roundMax: finalRoundMax(set) }}
            value={wagerDraft} onChange={setWagerDraft}
            onConfirm={(amount) => { send({ type: 'SET_FINAL_WAGER', teamId: pending.id, amount }); setWagerDraft(100); }}
          />
        );
      })()}

      {/* Final judging — per team */}
      {j.phase === 'final-judging' && (
        <div className="gsh__finaljudge">
          <div className="gsh__answer">Answer: {set.final.answer}</div>
          {teams.map((t) => (
            <div key={t.id} className="gsh__row">
              <span>{t.name} (wager {j.finalWagers[t.id]})</span>
              {j.finalJudged[t.id] == null ? (
                <>
                  <Btn label="✓" tone="primary" onClick={() => send({ type: 'JUDGE_FINAL', teamId: t.id, correct: true })} />
                  <Btn label="✗" tone="danger" onClick={() => send({ type: 'JUDGE_FINAL', teamId: t.id, correct: false })} />
                </>
              ) : <span>{j.finalJudged[t.id] ? '✓' : '✗'}</span>}
            </div>
          ))}
        </div>
      )}

      {j.phase === 'done' && <div className="gsh__done">Game over 🎉</div>}

      {buttons.length > 0 && (
        <div className="gsh__actions">
          {buttons.map((b) => <Btn key={b.label} label={b.label} tone={b.tone} onClick={() => send(b.command)} />)}
        </div>
      )}
    </div>
  );
}

function roundMax(round) {
  if (!round) return 1000;
  return Math.max(...round.categories.flatMap((c) => c.clues.map((q) => q.value))) * round.multiplier;
}
function finalRoundMax(set) {
  const last = set.rounds[set.rounds.length - 1];
  return Math.max(...last.categories.flatMap((c) => c.clues.map((q) => q.value))) * last.multiplier;
}

function WagerControl({ label, bounds, value, onChange, onConfirm }) {
  return (
    <div className="gsh__wager">
      <div className="gsh__wagerlabel">{label}</div>
      <div className="gsh__row">
        <Btn label="−100" onClick={() => onChange(clampWager(value - 100, bounds))} />
        <span className="gsh__wageramt">{clampWager(value, bounds).toLocaleString()}</span>
        <Btn label="+100" onClick={() => onChange(clampWager(value + 100, bounds))} />
      </div>
      <Btn label="Lock wager" tone="primary" onClick={() => onConfirm(clampWager(value, bounds))} />
    </div>
  );
}
