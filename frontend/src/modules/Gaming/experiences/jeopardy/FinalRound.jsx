import React, { useState } from 'react';
import TitleCard from '@gaming-ui/TitleCard.jsx';
import RevealPanel from '@gaming-ui/RevealPanel.jsx';
import MediaCluePlayer from '@gaming-ui/MediaCluePlayer.jsx';
import WagerPanel from './ui/WagerPanel.jsx';
import ControlLegend from '@gaming-ui/ControlLegend.jsx';
import GameButton from '@gaming-ui/GameButton.jsx';
import StageActions from '@gaming-ui/StageActions.jsx';
import './Jeopardy.scss';

function finalRoundMax(set) {
  const last = set.rounds[set.rounds.length - 1];
  return Math.max(...last.categories.flatMap((c) => c.clues.map((q) => q.value))) * Number(last.multiplier ?? 1);
}

export function FinalRound({ state, teams, scores, onAction }) {
  const { phase, set, finalWagers, finalJudged } = state;
  const [draft, setDraft] = useState(100);

  if (phase === 'final-category') {
    return (
      <div className="jp-final">
        <TitleCard title="Final Jeopardy" subtitle={set.final.category} />
        <GameButton tone="primary" autoFocus onClick={() => onAction({ type: 'START_ROUND' })}>Continue</GameButton>
      </div>
    );
  }

  if (phase === 'final-wager') {
    const pending = teams.find((t) => finalWagers[t.id] == null);
    const lockedNames = teams.filter((t) => finalWagers[t.id] != null).map((t) => t.name);
    return (
      <div className="jp-final">
        {lockedNames.length > 0 && <div className="jp-final__locked">Wagers locked: {lockedNames.join(', ')}</div>}
        <WagerPanel
          teamName={pending.name}
          score={Math.max(scores[pending.id] ?? 0, 0)}
          roundMax={finalRoundMax(set)}
          value={draft}
          onChange={setDraft}
          onConfirm={(amount) => { onAction({ type: 'SET_FINAL_WAGER', teamId: pending.id, amount }); setDraft(100); }}
        />
      </div>
    );
  }

  if (phase === 'final-clue') {
    return (
      <div className="jp-final">
        {set.final.media && <MediaCluePlayer media={set.final.media} />}
        <RevealPanel prompt={set.final.clue} revealed={false} />
        <ControlLegend items={[{ key: '↵', label: 'Reveal answer' }]} />
      </div>
    );
  }

  if (phase === 'final-judging') {
    return (
      <div className="jp-final">
        <RevealPanel prompt={set.final.clue} revealed answer={set.final.answer} />
        <div className="jp-final__judging">
          {teams.map((team) => (
            <div key={team.id} className="jp-final__team">
              <span>{team.name} (wagered {finalWagers[team.id]})</span>
              {finalJudged[team.id] == null ? (
                <StageActions>
                  <GameButton tone="success" onClick={() => onAction({ type: 'JUDGE_FINAL', teamId: team.id, correct: true })}>Correct</GameButton>
                  <GameButton tone="danger" onClick={() => onAction({ type: 'JUDGE_FINAL', teamId: team.id, correct: false })}>Wrong</GameButton>
                </StageActions>
              ) : (
                <span>{finalJudged[team.id] ? '✓' : '✗'}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}
export default FinalRound;
