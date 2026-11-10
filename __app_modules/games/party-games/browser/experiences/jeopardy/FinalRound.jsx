import React from 'react';
import TitleCard from "../../../../../../__capabilities/gaming/browser/platform/ui/TitleCard.jsx";
import RevealPanel from "../../../../../../__capabilities/gaming/browser/platform/ui/RevealPanel.jsx";
import LearnCard from "../../../../../../__capabilities/gaming/browser/platform/ui/LearnCard.jsx";
import MediaCluePlayer from "../../../../../../__capabilities/gaming/browser/platform/ui/MediaCluePlayer.jsx";
import "./Jeopardy.scss";

export function FinalRound({ state, teams }) {
  const { phase, set, finalWagers = {}, finalJudged = {} } = state;
  if (phase === 'final-category') {
    return <div className="jp-final">
      <TitleCard title="Final Jeopardy" subtitle={set.final.category} />
      <p>Waiting for the host.</p>
    </div>;
  }
  if (phase === 'final-wager') {
    return <div className="jp-final">
      <TitleCard title="Final Jeopardy" subtitle="Wagers" />
      {teams.map(team => <div className="jp-final__locked" key={team.id}>
        {team.name}: {finalWagers[team.id] == null ? 'Choosing a wager' : 'Wager locked'}
      </div>)}
    </div>;
  }
  if (phase === 'final-clue' || phase === 'final-judging') {
    return <div className="jp-final">
      {state.learning && phase === 'final-judging' && set.final.learn
        ? <LearnCard learn={set.final.learn} />
        : <>
          {set.final.media && <MediaCluePlayer media={set.final.media} />}
          <RevealPanel reference={set.final.scripture_reference} prompt={set.final.clue} revealed={phase === 'final-judging'} answer={set.final.answer} />
        </>}
      {phase === 'final-judging' && <div className="jp-final__judging">
        {teams.map(team => <div className="jp-final__team" key={team.id}>
          <span>{team.name} (wagered {finalWagers[team.id]})</span>
          <span>{finalJudged[team.id] == null ? 'Waiting for host judgment' : finalJudged[team.id] ? '✓' : '✗'}</span>
        </div>)}
      </div>}
    </div>;
  }
  return null;
}
export default FinalRound;
