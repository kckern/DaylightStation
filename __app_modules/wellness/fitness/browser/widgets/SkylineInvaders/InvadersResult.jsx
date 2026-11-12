import React from 'react';
import InvadersActions from './InvadersActions.jsx';
import './SkylineInvaders.scss';

// The end of a round: how it went, whether it is saved, and what to do next.
// A new round is not offered until the record is saved, so a result can never
// be lost by playing over it.

const TITLES = Object.freeze({ completed: 'Skyline held!', failed: 'Skyline fell short', abandoned: 'Round ended' });
const cls = (...names) => names.filter(Boolean).join(' ');

/**
 * @param {object} props
 * @param {object} props.record        the skyline-invaders-run/v1 record being saved
 * @param {'saving'|'saved'|'error'} props.saveStatus
 * @param {object} props.level         the level that was played
 * @param {object|null} props.nextLevel the next open level after a pass, if any
 * @param {object} [props.tracker]     aim tracker: the arms-wide press takes the first action
 */
export default function InvadersResult({ record, saveStatus, level, nextLevel = null, onReplay, onNext, onLevels, onRetrySave, tracker = null, active = true }) {
  const run = record.run;
  const passed = run.status === 'completed';
  const replay = { id: 'replay', label: run.status === 'failed' ? 'Try again' : 'Play again', onPress: () => onReplay?.() };
  const levels = { id: 'levels', label: 'Levels', onPress: () => onLevels?.() };
  let actions;
  if (saveStatus === 'error') actions = [{ id: 'retry-save', label: 'Retry save', hint: 'Needed before the next round', onPress: () => onRetrySave?.() }];
  else if (saveStatus === 'saving') actions = [{ id: 'saving', label: 'Saving…', disabled: true, onPress: () => {} }];
  else if (passed && nextLevel) actions = [{ id: 'next', label: 'Next level', hint: nextLevel.name, onPress: () => onNext?.() }, replay, levels];
  else actions = [replay, levels];
  const rows = [
    ['Shot down', `${run.kills} of ${level.pass.kills}`],
    ['Score', run.score.toLocaleString('en-US')],
    ['Best combo', `×${run.best_combo}`],
    ['Skyline', `${run.base_hp}%`],
  ];
  return (
    <section className="skyline-invaders__result" data-testid="skyline-invaders-result" data-status={run.status} data-save={saveStatus} aria-label="Round result">
      <header className="skyline-invaders__result-head">
        <p>{level.name}</p>
        <h1>{TITLES[run.status] || TITLES.abandoned}</h1>
        <span className="skyline-invaders__stars-row skyline-invaders__stars-row--result" role="img" aria-label={`${run.stars} of 3 stars`}>
          {[1, 2, 3].map((n) => <span key={n} className={cls('skyline-invaders__star', n <= run.stars && 'is-won')} aria-hidden="true">★</span>)}
        </span>
      </header>
      <dl className="skyline-invaders__result-rows">
        {rows.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      {saveStatus === 'saved' && <p className="skyline-invaders__result-save" role="status">{run.reward_rings > 0 ? `Saved. +${run.reward_rings} rings` : 'Saved.'}</p>}
      {saveStatus === 'saving' && <p className="skyline-invaders__result-save" role="status">Saving the round…</p>}
      {saveStatus === 'error' && <p className="skyline-invaders__result-save" role="alert">This round is not saved yet. Retry before playing again.</p>}
      <InvadersActions actions={actions} active={active} tracker={saveStatus === 'saved' ? tracker : null} onBack={saveStatus === 'saved' ? onLevels : undefined} />
      <p className="skyline-invaders__how">Tap a button, press any key, or A on the gamepad. Left and right move between the choices.</p>
    </section>
  );
}
