import React, { useState } from 'react';
import RevealPanel from '../../shell/components/RevealPanel.jsx';
import MediaCluePlayer from '../../shell/components/MediaCluePlayer.jsx';
import ControlLegend from '../../shell/components/ControlLegend.jsx';
import TimerRing from '../../shell/timers/TimerRing.jsx';
import { useCountdown } from '../../shell/timers/useCountdown.js';
import './Jeopardy.scss';

/**
 * Owns the per-clue countdown so the parent can remount (via key) for a fresh
 * timer on every clue. Presentation-only otherwise — actions come from keys /
 * the host companion, applied by the parent.
 */
export function ClueScreen({ state, timerSeconds = 12, onTimeout, lockedTeam = null }) {
  const [mediaError, setMediaError] = useState(null);
  const { active, revealed, isDailyDouble, wager, phase } = state;
  const running = phase === 'clue' && !revealed;
  const { progress } = useCountdown({ seconds: timerSeconds, running, onExpire: onTimeout });
  if (!active) return null;
  const round = state.set.rounds[state.roundIndex];
  const value = isDailyDouble ? wager : active.clue.value * round.multiplier;
  const judging = phase === 'judging';
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
