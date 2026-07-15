import React, { useState } from 'react';
import RevealPanel from '../../shell/components/RevealPanel.jsx';
import MediaCluePlayer from '../../shell/components/MediaCluePlayer.jsx';
import ControlLegend from '../../shell/components/ControlLegend.jsx';
import TimerRing from '../../shell/timers/TimerRing.jsx';
import './Jeopardy.scss';

export function ClueScreen({ state, teams, progress = 1, lockedTeam = null }) {
  const [mediaError, setMediaError] = useState(null);
  const { active, revealed, isDailyDouble, wager } = state;
  if (!active) return null;
  const round = state.set.rounds[state.roundIndex];
  const value = isDailyDouble ? wager : active.clue.value * round.multiplier;
  const judging = state.phase === 'judging';
  const legend = judging
    ? [{ key: '↑', label: 'Correct' }, { key: '↓', label: 'Wrong' }, ...(revealed ? [] : [{ key: '↵', label: 'Show answer' }])]
    : revealed
      ? [{ key: '↵', label: 'Back to board' }]
      : [{ key: 'Esc', label: 'Time out' }];

  return (
    <div className="jp-clue" data-testid="clue-screen">
      <div className="jp-clue__banner">
        {isDailyDouble && <span className="jp-clue__dd">DAILY DOUBLE</span>}
        <span className="jp-clue__value">${value?.toLocaleString?.() ?? value}</span>
        <TimerRing progress={progress} size={72} />
      </div>
      {active.clue.media && !mediaError && (
        <MediaCluePlayer media={active.clue.media} onError={setMediaError} />
      )}
      {mediaError && <div className="jp-clue__media-error">{mediaError}</div>}
      <RevealPanel prompt={active.clue.clue} revealed={revealed} answer={active.clue.answer} />
      {lockedTeam && (
        <div className="jp-clue__locked" style={{ '--team-color': lockedTeam.color }}>
          {lockedTeam.name} buzzed in!
        </div>
      )}
      <ControlLegend items={legend} />
    </div>
  );
}
export default ClueScreen;
