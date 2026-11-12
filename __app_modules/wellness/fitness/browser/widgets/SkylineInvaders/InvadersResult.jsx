import React from 'react';
import { StarRow } from './InvadersMenus.jsx';

// The end of a round, in Skyline Glider's "Back at base" window: the stars,
// each number against what the wave asked for, and whether it is saved. What
// comes next is on the bike buttons (replay, next wave, waves, change
// shooter), offered only once the record is saved, so a result can never be
// lost by playing over it.

const TITLES = Object.freeze({ completed: 'Skyline held!', failed: 'Skyline fell short', abandoned: 'Round ended' });

/**
 * @param {object} props
 * @param {object} props.record        the skyline-invaders-run/v1 record being saved
 * @param {'saving'|'saved'|'error'} props.saveStatus
 * @param {object} props.level         the level that was played
 */
export default function InvadersResult({ record, saveStatus, level }) {
  const run = record.run;
  const hpMin = level.pass.base_hp_min ?? 0;
  // Each number stands alone, with what the wave asked for beside it. "25 of 4"
  // reads as a mistake once a round beats its target.
  const rows = [
    { id: 'kills', label: 'Shot down', value: String(run.kills), note: `needed ${level.pass.kills}`, met: run.kills >= level.pass.kills },
    { id: 'skyline', label: 'Skyline', value: `${run.base_hp}%`, ...(hpMin > 0 ? { note: `needed ${hpMin}%`, met: run.base_hp >= hpMin } : {}) },
    { id: 'combo', label: 'Best combo', value: `x${run.best_combo}` },
    { id: 'score', label: 'Score', value: run.score.toLocaleString('en-US') },
  ];
  return (
    <div className="skyline-menus" data-phase="result" data-testid="skyline-invaders-result" data-status={run.status} data-save={saveStatus}>
      <p className="skyline-menus__kicker">{level.name}</p>
      <h1>{TITLES[run.status] || TITLES.abandoned}</h1>
      <StarRow count={run.stars} className="skyline-invaders__star-row--result" />
      <dl className="skyline-menus__summary skyline-invaders__summary">
        {rows.map((row) => (
          <div key={row.id} data-stat={row.id} data-testid={`invaders-result-${row.id}`} data-met={row.note ? String(row.met) : undefined}>
            <dt>{row.label}{row.note && <small>{row.note}</small>}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {saveStatus === 'saved' && <p className="skyline-invaders__save" data-tone="good" role="status">{run.reward_rings > 0 ? `Saved · +${run.reward_rings} rings` : 'Saved'}</p>}
      {saveStatus === 'saving' && <p className="skyline-invaders__save" role="status">Saving…</p>}
      {saveStatus === 'error' && <p className="skyline-invaders__save" data-tone="bad" role="alert">Not saved yet. Retry save before the next round.</p>}
    </div>
  );
}
