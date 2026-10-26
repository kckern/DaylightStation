import React, { useState } from 'react';
import RevealPanel from "../../../../../../__capabilities/gaming/browser/platform/ui/RevealPanel.jsx";
import MediaCluePlayer from "../../../../../../__capabilities/gaming/browser/platform/ui/MediaCluePlayer.jsx";
import TimerRing from "../../../../../../__capabilities/gaming/browser/platform/ui/TimerRing.jsx";
import { useCountdown } from "../../../../../../__capabilities/gaming/browser/platform/ui/useCountdown.js";
import { onColor } from "../../../../../../__capabilities/gaming/browser/platform/ui/teamColors.js";
import MemberAvatar from "../../../../../../__capabilities/gaming/browser/platform/ui/MemberAvatar.jsx";
import BabyIcon from "./BabyIcon.jsx";
import "./Jeopardy.scss";

/**
 * Owns the per-clue countdown so the parent can remount (via key) for a fresh
 * timer on every timed trivia clue. Open-book games wait for the phone host.
 */
export function ClueScreen({ state, timerSeconds = 12, onTimeout, lockedTeam = null, pendingTeam = null }) {
  const [mediaError, setMediaError] = useState(null);
  const { active, revealed, isDailyDouble, wager, phase } = state;
  const running = !state.set.open_book && !active?.clue.little_kids && phase === 'clue' && !state.answeringTeamId && !revealed;
  const { progress, remaining } = useCountdown({ seconds: timerSeconds, running, onExpire: onTimeout });
  if (!active) return null;
  const round = state.set.rounds[state.roundIndex];
  const value = isDailyDouble ? wager : active.clue.value * Number(round.multiplier ?? 1);
  const judging = phase === 'judging';

  return (
    <div className={`jp-clue${revealed ? ' jp-clue--revealed' : ''}${active.clue.media && !mediaError ? ' jp-clue--media' : ''}`} data-testid="clue-screen">
      <div className="jp-clue__banner">
        {active.clue.little_kids && <BabyIcon className="jp-clue__kids" />}
        {isDailyDouble && <span className="jp-clue__dd">DAILY DOUBLE</span>}
        <span className="jp-clue__value">${value?.toLocaleString?.() ?? value}</span>
        {!state.set.open_book && !active.clue.little_kids && !judging && !revealed && !state.answeringTeamId && <TimerRing progress={progress} remaining={remaining} size={72} />}
      </div>
      {pendingTeam && <p className="jp-clue__pending" role="status">{pendingTeam.name} buzz received — confirming…</p>}
      {active.clue.media && !mediaError && (
        <MediaCluePlayer media={active.clue.media} onError={setMediaError} />
      )}
      {mediaError && <div className="jp-clue__media-error">{mediaError}</div>}
      <RevealPanel reference={active.clue.scripture_reference} prompt={active.clue.clue} revealed={revealed || phase === 'answer-review'} answer={active.clue.answer} />
      {phase === 'answer-review' && <p className="jp-clue__review" role="status">{state.answerReview?.judgmentPending ? 'Listen, then mark Correct or Wrong on your phone.' : `${state.answerReview?.correct === true ? 'Correct' : state.answerReview?.correct === false ? 'Wrong' : 'Answer revealed'}${state.answerReview?.scoreDelta ? ` · ${state.answerReview.scoreDelta > 0 ? '+' : '−'}${Math.abs(state.answerReview.scoreDelta)} points` : ''} · Next question on your phone`}</p>}
      {lockedTeam && (
        <div className="jp-clue__locked" style={{ '--team-color': lockedTeam.color, '--team-on': onColor(lockedTeam.color) }}>
          {lockedTeam.members?.length > 0 && (
            <span className="jp-clue__lockedavatars">
              {lockedTeam.members.map((m) => (
                <MemberAvatar key={m.id} member={m} teamColor={lockedTeam.color} size={30} />
              ))}
            </span>
          )}
          {lockedTeam.name}{round.mode === 'turns' || isDailyDouble || active.clue.little_kids ? ' answers' : ' buzzed in!'}
        </div>
      )}
    </div>
  );
}
export default ClueScreen;
