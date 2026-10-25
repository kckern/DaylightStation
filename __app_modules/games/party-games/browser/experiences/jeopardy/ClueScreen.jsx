import React, { useState } from 'react';
import RevealPanel from "../../../../../../__capabilities/gaming/browser/platform/ui/RevealPanel.jsx";
import MediaCluePlayer from "../../../../../../__capabilities/gaming/browser/platform/ui/MediaCluePlayer.jsx";
import ControlLegend from "../../../../../../__capabilities/gaming/browser/platform/ui/ControlLegend.jsx";
import TimerRing from "../../../../../../__capabilities/gaming/browser/platform/ui/TimerRing.jsx";
import { useCountdown } from "../../../../../../__capabilities/gaming/browser/platform/ui/useCountdown.js";
import { onColor } from "../../../../../../__capabilities/gaming/browser/platform/ui/teamColors.js";
import MemberAvatar from "../../../../../../__capabilities/gaming/browser/platform/ui/MemberAvatar.jsx";
import "./Jeopardy.scss";

/**
 * Owns the per-clue countdown so the parent can remount (via key) for a fresh
 * timer on every clue. Presentation-only otherwise — actions come from keys /
 * the host companion, applied by the parent.
 */
export function ClueScreen({ state, timerSeconds = 12, onTimeout, lockedTeam = null }) {
  const [mediaError, setMediaError] = useState(null);
  const { active, revealed, isDailyDouble, wager, phase } = state;
  const running = phase === 'clue' && !revealed;
  const { progress, remaining } = useCountdown({ seconds: timerSeconds, running, onExpire: onTimeout });
  if (!active) return null;
  const round = state.set.rounds[state.roundIndex];
  const value = isDailyDouble ? wager : active.clue.value * Number(round.multiplier ?? 1);
  const judging = phase === 'judging';
  const legend = judging
    ? [...(revealed || round.mode === 'hosted' ? [{ key: '↑', label: 'Correct' }, { key: '↓', label: 'Wrong' }] : []), ...(!revealed ? [{ key: 'OK', label: 'Show answer' }] : [])]
    : revealed
      ? [{ key: 'OK', label: 'Back to board' }]
      : [...(state.answeringTeamId ? [{ key: 'OK', label: 'Show answer' }] : []), { key: 'Back', label: 'Time out' }];

  return (
    <div className={`jp-clue${active.clue.media && !mediaError ? ' jp-clue--media' : ''}`} data-testid="clue-screen">
      <div className="jp-clue__banner">
        {active.clue.little_kids && <span className="jp-clue__kids">Little kids’ turn</span>}
        {isDailyDouble && <span className="jp-clue__dd">DAILY DOUBLE</span>}
        <span className="jp-clue__value">${value?.toLocaleString?.() ?? value}</span>
        {!judging && <TimerRing progress={progress} remaining={remaining} size={72} />}
      </div>
      {active.clue.media && !mediaError && (
        <MediaCluePlayer media={active.clue.media} onError={setMediaError} />
      )}
      {mediaError && <div className="jp-clue__media-error">{mediaError}</div>}
      <RevealPanel prompt={active.clue.clue} revealed={revealed} answer={active.clue.answer} />
      {lockedTeam && (
        <div className="jp-clue__locked" style={{ '--team-color': lockedTeam.color, '--team-on': onColor(lockedTeam.color) }}>
          {lockedTeam.members?.length > 0 && (
            <span className="jp-clue__lockedavatars">
              {lockedTeam.members.map((m) => (
                <MemberAvatar key={m.id} member={m} teamColor={lockedTeam.color} size={30} />
              ))}
            </span>
          )}
          {lockedTeam.name}{round.mode === 'turns' || isDailyDouble ? ' answers' : ' buzzed in!'}
        </div>
      )}
      <ControlLegend items={legend} />
    </div>
  );
}
export default ClueScreen;
