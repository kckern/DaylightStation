// Mobile host companion. A phone the host holds to drive the game running on
// the TV: WebSocket invalidations trigger an authenticated projection fetch,
// and commands go directly to the session authority.
import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { fetchSession, printHostPacket, sendRuleCommand } from '../app/sessionClient.js';
import { sendJeopardyCommand } from '../../../experiences/jeopardy/jeopardyClient.js';
import { clampWager } from '../ui/wager.js';
import { hostButtons } from './hostView.js';
import MemberAvatar from '../ui/MemberAvatar.jsx';
import './GroupPlayHost.scss';
import '../ui/fonts.js';

function Btn({ label, tone = 'plain', onClick }) {
  return <button type="button" className={`gp-host-btn gp-host-btn--${tone}`} onClick={onClick}>{label}</button>;
}

export default function GroupPlayHost() {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [set, setSet] = useState(null);
  const [snap, setSnap] = useState(null); // canonical projected state
  const [error, setError] = useState(null);
  const [wagerDraft, setWagerDraft] = useState(100);
  const [printStatus, setPrintStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchSession(sessionId, { role: 'host' })
      .then((s) => {
        if (cancelled) return;
        setSession(s); setSet(s.state.set || null); setSnap({ state: s.state, scores: s.state.scores || {} });
      })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [sessionId]);

  useWebSocketSubscription('gaming', (msg) => {
    if (msg?.kind === 'session-updated' && msg.sessionId === sessionId) {
      fetchSession(sessionId).then((result) => { setSession(result); setSet(result.state.set || null); setSnap({ state: result.state, scores: result.state?.scores || {} }); }).catch((cause) => setError(cause.message));
    }
  }, [sessionId]);

  const rulesetId = session?.header?.ruleset?.id;
  const send = useCallback((command) => {
    const request = rulesetId === 'jeopardy' ? sendJeopardyCommand(sessionId, command) : sendRuleCommand(sessionId, command);
    request.then((result) => setSnap({ state: result.state, scores: result.state?.scores || {} })).catch((cause) => setError(cause.message));
  }, [rulesetId, sessionId]);
  const print = useCallback(() => { setPrintStatus('printing'); printHostPacket(sessionId).then((result) => setPrintStatus(result.status)).catch(() => setPrintStatus('failed')); }, [sessionId]);

  if (error) return <div className="gp-host gp-host--error">{error}</div>;
  if (!session) return <div className="gp-host gp-host--loading">Connecting to game…</div>;

  const teams = session.header.seats || [];
  const teamName = (id) => teams.find((t) => t.id === id)?.name || id;
  const j = snap?.state;
  const scores = snap?.scores || {};

  if (!j) return <div className="gp-host gp-host--loading">Waiting for the TV… (session {sessionId})</div>;

  if (rulesetId !== 'jeopardy') return <GenericGamingHost rulesetId={rulesetId} definition={session.definition} state={j} teams={teams} scores={scores} send={send} print={print} printStatus={printStatus} />;

  const round = set.rounds[j.roundIndex];
  const buttons = hostButtons(j);

  return (
    <div className="gp-host" data-phase={j.phase}>
      <header className="gp-host__scores">
        {teams.map((t) => (
          <span key={t.id} className="gp-host__score" style={{ '--team-color': t.color || '#888' }}>
            <b>{t.name}</b> {(scores[t.id] ?? 0).toLocaleString()}
            {t.members?.length > 0 && (
              <span className="gp-host__scoreavatars">
                {t.members.map((m) => (
                  <MemberAvatar key={m.id} member={m} teamColor={t.color || '#888'} size={20} />
                ))}
              </span>
            )}
          </span>
        ))}
      </header>

      <div className="gp-host__phase">{j.phase.replace(/-/g, ' ')}</div>
      <div className="gp-host__row"><Btn label={printStatus === 'printing' ? 'Printing…' : 'Print host packet'} onClick={print} />{printStatus && printStatus !== 'printing' && <span>{printStatus}</span>}</div>

      {/* Board — direct tile picker */}
      {j.phase === 'board' && round && (
        <div className="gp-host__board" style={{ '--cats': round.categories.length }}>
          {round.categories.map((cat, c) => (
            <div key={c} className="gp-host__col">
              <div className="gp-host__cat">{cat.name}</div>
              {cat.clues.map((clue, r) => {
                const used = j.used[`${j.roundIndex}:${c}:${r}`];
                return (
                  <button key={r} type="button" disabled={used}
                    className={`gp-host__tile${used ? ' is-used' : ''}`}
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
        <div className="gp-host__clue">
          <div className="gp-host__cluetext">{j.active.clue.clue}</div>
          <div className="gp-host__answer">Answer: {j.active.clue.answer}</div>
          {/* No-hardware path: designate who answers */}
          {j.phase === 'clue' && !j.isDailyDouble && !j.revealed && round?.mode !== 'turns' && (
            <div className="gp-host__row">
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
        <div className="gp-host__finaljudge">
          <div className="gp-host__answer">Answer: {set.final.answer}</div>
          {teams.map((t) => (
            <div key={t.id} className="gp-host__row">
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

      {j.phase === 'done' && <div className="gp-host__done">Game over 🎉</div>}

      {buttons.length > 0 && (
        <div className="gp-host__actions">
          {buttons.map((b) => <Btn key={b.label} label={b.label} tone={b.tone} onClick={() => send(b.command)} />)}
        </div>
      )}
    </div>
  );
}

function GenericGamingHost({ rulesetId, definition, state, teams, scores, send, print, printStatus }) {
  if (rulesetId === 'activity-party') return <div className="gp-host" data-phase={state.phase}>
    <header className="gp-host__scores">{teams.map((team) => <span key={team.id} className="gp-host__score"><b>{team.name}</b> {scores[team.id] || 0}</span>)}</header>
    <div className="gp-host__phase">{state.phase.replaceAll('-', ' ')}</div>
    <div className="gp-host__row"><Btn label={printStatus === 'printing' ? 'Printing…' : 'Print host packet'} onClick={print} />{printStatus && printStatus !== 'printing' && <span>{printStatus}</span>}</div>
    {state.host?.mode === 'human' && <div className="gp-host__finaljudge" aria-label="Score adjustments">{teams.map((team) => <div key={team.id} className="gp-host__row"><span>{team.name}</span><Btn label="−1" onClick={() => send({ type: 'score.adjust', subject_id: team.id, delta: -1 })} /><Btn label="+1" onClick={() => send({ type: 'score.adjust', subject_id: team.id, delta: 1 })} /></div>)}</div>}
    {state.challenge && <div className="gp-host__clue"><div className="gp-host__cluetext">{state.challenge.prompt}</div>{(state.challenge.hints || []).slice(0, state.revealed_hints).map((hint) => <div key={hint} className="gp-host__answer">{hint}</div>)}</div>}
    <div className="gp-host__actions">
      {state.phase === 'performer-ready' && <Btn label="Performer ready" tone="primary" onClick={() => send({ type: 'performer.ready' })} />}
      {state.phase === 'challenge-ready' && <Btn label="Start timer" tone="primary" onClick={() => send({ type: 'challenge.start' })} />}
      {state.phase === 'performing' && <><Btn label="Reveal next hint" onClick={() => send({ type: 'host.reveal' })} /><Btn label="Finish" tone="primary" onClick={() => send({ type: 'challenge.finish' })} /></>}
      {state.phase === 'adjudication' && <><Btn label="Correct" tone="primary" onClick={() => send({ type: 'outcome.correct' })} /><Btn label="Incorrect" tone="danger" onClick={() => send({ type: 'outcome.incorrect' })} /><Btn label="Pass" onClick={() => send({ type: 'outcome.pass' })} /></>}
      {state.phase === 'challenge-complete' && <Btn label="Next performer" tone="primary" onClick={() => send({ type: 'challenge.next' })} />}
    </div>
  </div>;
  if (rulesetId === 'dice') return <div className="gp-host"><div className="gp-host__phase">{definition?.title || 'Dice'}</div><div className="gp-host__done">{state.outcome ? `${state.outcome.notation}: ${state.outcome.total}` : 'Ready'}</div><div className="gp-host__actions"><Btn label="Roll" tone="primary" onClick={() => send({ type: 'dice.roll', notation: state.notation })} /></div></div>;
  if (rulesetId === 'selector') return <div className="gp-host"><div className="gp-host__phase">{definition?.title || 'Selection'}</div><div className="gp-host__done">{state.selected?.name || 'Ready'}</div><div className="gp-host__actions"><Btn label="Pick" tone="primary" onClick={() => send({ type: 'selector.pick' })} /></div></div>;
  return <div className="gp-host gp-host--error">Unsupported host experience: {rulesetId}</div>;
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
    <div className="gp-host__wager">
      <div className="gp-host__wagerlabel">{label}</div>
      <div className="gp-host__row">
        <Btn label="−100" onClick={() => onChange(clampWager(value - 100, bounds))} />
        <span className="gp-host__wageramt">{clampWager(value, bounds).toLocaleString()}</span>
        <Btn label="+100" onClick={() => onChange(clampWager(value + 100, bounds))} />
      </div>
      <Btn label="Lock wager" tone="primary" onClick={() => onConfirm(clampWager(value, bounds))} />
    </div>
  );
}
