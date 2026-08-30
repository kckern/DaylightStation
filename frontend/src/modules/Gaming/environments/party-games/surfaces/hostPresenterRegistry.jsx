import React from 'react';
import MemberAvatar from '@gaming-ui/MemberAvatar.jsx';
import { clampWager } from '@gaming/experiences/jeopardy/ui/wager.js';
import { hostButtons } from './hostView.js';

const PHASE_LABELS = Object.freeze({
  'round-intro': 'Round introduction', board: 'Choose a clue', clue: 'Clue in play', judging: 'Judge the answer', wager: 'Set the wager',
  'final-category': 'Final category', 'final-wager': 'Final wagers', 'final-clue': 'Final clue', 'final-judging': 'Judge final answers', done: 'Game complete',
  'performer-ready': 'Performer handoff', 'challenge-ready': 'Secret ready', performing: 'Round in progress', adjudication: 'Judge the round', verification: 'Waiting for verification', 'challenge-complete': 'Round complete', complete: 'Game complete',
});

export function HostButton({ label, tone = 'plain', onClick, pending = false, disabled = false }) {
  return <button type="button" className={`gp-host-btn gp-host-btn--${tone}`} aria-busy={pending || undefined} disabled={disabled || pending} onClick={onClick}>{label}</button>;
}

function Phase({ value }) {
  return <div className="gp-host__phase">{PHASE_LABELS[value] || String(value || '').replaceAll('-', ' ')}</div>;
}

function Scores({ teams, scores }) {
  return <header className="gp-host__scores">{teams.map((team) => <span key={team.id} className="gp-host__score" style={{ '--team-color': team.color || 'var(--gp-neutral-team)' }}><b>{team.name}</b> {(scores[team.id] ?? 0).toLocaleString()}{team.members?.length > 0 && <span className="gp-host__scoreavatars">{team.members.map((member) => <MemberAvatar key={member.id} member={member} teamColor={team.color} size={20} />)}</span>}</span>)}</header>;
}

const multiplier = (round) => Number(round?.multiplier ?? 1);
const roundMax = (round) => round ? Math.max(...round.categories.flatMap((category) => category.clues.map((clue) => clue.value))) * multiplier(round) : 1000;
const finalRoundMax = (set) => roundMax(set.rounds[set.rounds.length - 1]);

function WagerControl({ label, bounds, value, onChange, onConfirm, pending }) {
  return <div className="gp-host__wager"><div className="gp-host__wagerlabel">{label}</div><div className="gp-host__row"><HostButton label="−100" disabled={pending} onClick={() => onChange(clampWager(value - 100, bounds))} /><span className="gp-host__wageramt">{clampWager(value, bounds).toLocaleString()}</span><HostButton label="+100" disabled={pending} onClick={() => onChange(clampWager(value + 100, bounds))} /></div><HostButton label="Lock wager" tone="primary" pending={pending} onClick={() => onConfirm(clampWager(value, bounds))} /></div>;
}

export function JeopardyHost({ state, set, teams, scores, send, pending, wagerDraft, setWagerDraft, print, printStatus }) {
  const round = set.rounds[state.roundIndex];
  const buttons = hostButtons(state);
  const teamName = (id) => teams.find((team) => team.id === id)?.name || id;
  return <>
    <Scores teams={teams} scores={scores} />
    <Phase value={state.phase} />
    {state.phase === 'board' && <div className="gp-host__utility"><HostButton label={printStatus === 'printing' ? 'Printing…' : 'Print host packet'} disabled={printStatus === 'printing'} onClick={print} />{printStatus && printStatus !== 'printing' && <span>{printStatus}</span>}</div>}
    {state.phase === 'board' && round && <div className="gp-host__board" style={{ '--cats': round.categories.length }}>{round.categories.map((category, categoryIndex) => <div key={category.name} className="gp-host__col"><div className="gp-host__cat">{category.name}</div>{category.clues.map((clue, rowIndex) => { const used = state.used[`${state.roundIndex}:${categoryIndex}:${rowIndex}`]; return <button key={rowIndex} type="button" disabled={used || pending} className={`gp-host__tile${used ? ' is-used' : ''}`} onClick={() => send({ type: 'SELECT_AT', cat: categoryIndex, row: rowIndex })}>{used ? '' : `$${clue.value * multiplier(round)}`}</button>; })}</div>)}</div>}
    {(state.phase === 'clue' || state.phase === 'judging') && state.active && <div className="gp-host__clue"><div className="gp-host__cluetext">{state.active.clue.clue}</div><div className="gp-host__answer">Answer: {state.active.clue.answer}</div>{state.phase === 'clue' && !state.isDailyDouble && !state.revealed && round?.mode !== 'turns' && <div className="gp-host__row">{teams.filter((team) => !state.attempted.includes(team.id)).map((team) => <HostButton key={team.id} label={`${team.name} answers`} tone="team" disabled={pending} onClick={() => send({ type: 'BUZZ', teamId: team.id })} />)}</div>}</div>}
    {state.phase === 'wager' && <WagerControl label={`${teamName(state.answeringTeamId)} — wager`} bounds={{ score: Math.max(scores[state.answeringTeamId] ?? 0, 0), roundMax: roundMax(round) }} value={wagerDraft} onChange={setWagerDraft} pending={pending} onConfirm={(amount) => { send({ type: 'SET_WAGER', amount }); setWagerDraft(100); }} />}
    {state.phase === 'final-wager' && (() => { const team = teams.find((candidate) => state.finalWagers[candidate.id] == null); return team ? <WagerControl label={`${team.name} — final wager`} bounds={{ score: Math.max(scores[team.id] ?? 0, 0), roundMax: finalRoundMax(set) }} value={wagerDraft} onChange={setWagerDraft} pending={pending} onConfirm={(amount) => { send({ type: 'SET_FINAL_WAGER', teamId: team.id, amount }); setWagerDraft(100); }} /> : null; })()}
    {state.phase === 'final-judging' && <div className="gp-host__finaljudge"><div className="gp-host__answer">Answer: {set.final.answer}</div>{teams.map((team) => <div key={team.id} className="gp-host__row"><span>{team.name} (wager {state.finalWagers[team.id]})</span>{state.finalJudged[team.id] == null ? <><HostButton label="Correct" tone="primary" disabled={pending} onClick={() => send({ type: 'JUDGE_FINAL', teamId: team.id, correct: true })} /><HostButton label="Wrong" tone="danger" disabled={pending} onClick={() => send({ type: 'JUDGE_FINAL', teamId: team.id, correct: false })} /></> : <span>{state.finalJudged[team.id] ? 'Correct' : 'Wrong'}</span>}</div>)}</div>}
    {state.phase === 'done' && <div className="gp-host__done">Game complete</div>}
    {buttons.length > 0 && <div className="gp-host__actions">{buttons.map((button) => <HostButton key={button.label} label={button.label} tone={button.tone} pending={pending} onClick={() => send(button.command)} />)}</div>}
  </>;
}

export function ActivityHost({ state, teams, scores, send, pending, print, printStatus }) {
  return <><Scores teams={teams} scores={scores} /><Phase value={state.phase} />
    {state.phase === 'performer-ready' && <div className="gp-host__utility"><HostButton label={printStatus === 'printing' ? 'Printing…' : 'Print host packet'} disabled={printStatus === 'printing'} onClick={print} /></div>}
    {state.challenge && <div className="gp-host__clue"><div className="gp-host__cluetext">{state.challenge.prompt}</div>{(state.challenge.hints || []).slice(0, state.revealed_hints).map((hint) => <div key={hint} className="gp-host__answer">{hint}</div>)}</div>}
    {state.host?.mode === 'human' && <details className="gp-host__adjust"><summary>Score adjustment</summary>{teams.map((team) => <div key={team.id} className="gp-host__row"><span>{team.name}</span><HostButton label="−1" disabled={pending} onClick={() => send({ type: 'score.adjust', subject_id: team.id, delta: -1 })} /><HostButton label="+1" disabled={pending} onClick={() => send({ type: 'score.adjust', subject_id: team.id, delta: 1 })} /></div>)}</details>}
    <div className="gp-host__actions">{state.phase === 'performer-ready' && <HostButton label="Performer is ready" tone="primary" pending={pending} onClick={() => send({ type: 'performer.ready' })} />}{state.phase === 'challenge-ready' && <HostButton label="Start timer" tone="primary" pending={pending} onClick={() => send({ type: 'challenge.start' })} />}{state.phase === 'performing' && <><HostButton label="Reveal next hint" disabled={pending} onClick={() => send({ type: 'host.reveal' })} /><HostButton label="Finish round" tone="primary" pending={pending} onClick={() => send({ type: 'challenge.finish' })} /></>}{state.phase === 'adjudication' && <><HostButton label="Completed" tone="primary" pending={pending} onClick={() => send({ type: 'outcome.correct' })} /><HostButton label="Not completed" tone="danger" pending={pending} onClick={() => send({ type: 'outcome.incorrect' })} /><HostButton label="Pass" pending={pending} onClick={() => send({ type: 'outcome.pass' })} /></>}{state.phase === 'challenge-complete' && <HostButton label="Next performer" tone="primary" pending={pending} onClick={() => send({ type: 'challenge.next' })} />}</div>
  </>;
}

export function DiceHost({ definition, state, send, pending }) {
  return <><Phase value={state.outcome ? 'Roll committed' : 'Ready to roll'} /><div className="gp-host__done">{state.outcome ? `${state.outcome.notation}: ${state.outcome.total}` : definition?.title || 'Dice'}</div><div className="gp-host__actions"><HostButton label={state.outcome ? 'Roll again' : 'Roll dice'} tone="primary" pending={pending} onClick={() => send({ type: 'dice.roll', notation: state.notation })} /></div></>;
}

export function SelectorHost({ definition, state, send, pending }) {
  return <><Phase value={state.selected ? 'Selection committed' : 'Ready to choose'} /><div className="gp-host__done">{state.selected?.name || definition?.title || 'Selection'}</div><div className="gp-host__actions"><HostButton label={state.selected ? 'Pick again' : 'Pick someone'} tone="primary" pending={pending} onClick={() => send({ type: 'selector.pick' })} /></div></>;
}
