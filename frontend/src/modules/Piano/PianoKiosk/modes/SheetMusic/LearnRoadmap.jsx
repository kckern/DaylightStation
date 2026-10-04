/* eslint-disable react-refresh/only-export-components -- pure projections are exported beside their sole host for focused contract tests. */
import ExerciseRun from '../Exercises/ExerciseRun.jsx';
import LearnLab, { learnDrillProjection, learnPracticeRequirement } from './LearnLab.jsx';
export { learnDrillProjection, learnPracticeRequirement };

/** Compatibility adapter for callers mounted before LearnLab became first class. */
export function LearnPassageSession({ passage, onBack, ...props }) {
  return <LearnLab {...props} segment={passage} onClose={onBack} onRungPassed={onBack} />;
}

/** Self-directed practice never writes the preset passage ladder. */
export function CustomLearnSession({ score, range, measures = [], activeParts = ['rh', 'lh'], onResult, onBack }) {
  const start = measures[range.inMeasure]?.number ?? range.inMeasure + 1;
  const end = measures[range.outMeasure]?.number ?? range.outMeasure + 1;
  const label = `Bars ${start}–${end}`;
  return <section className="piano-learn-lab" role="dialog" aria-modal="true" aria-label={`${label} · Custom practice`}>
    <header className="piano-learn-lab__toolbar">
      <button className="piano-learn-lab__back" type="button" onClick={onBack} aria-label="Back to selected bars">
        <span aria-hidden="true">‹</span><span>Back</span>
      </button>
      <div className="piano-learn-lab__identity"><strong>Selected bars</strong><span>{label}</span></div>
      <div className="piano-learn-lab__task"><strong>Custom practice</strong><span>Play accurately at your own pace</span></div>
    </header>
    <ExerciseRun
      instance={null}
      score={{ ...score, measures: [start, end], rangeIndices: { start: range.inMeasure, end: range.outMeasure }, activeParts }}
      intent="practice"
      practiceMode="free"
      practiceRequirement={{ mode: 'free', rubric: { id: 'sheet-music-custom-range', version: '1', criteria: { completeness: 1, cleanliness: 1 } } }}
      programId={`learn:custom:${score.id}`}
      stepId={`bars:${range.inMeasure}-${range.outMeasure}`}
      framing={`${label} · Custom practice`}
      ask="Play the selected bars at your own pace."
      bare surface="learn-lab" scoreCursorPolicy="always" keyboardHintPolicy="after-wrong"
      onExit={onBack}
      onPassed={onResult}
      onFailed={onResult}
      onUnavailable={onBack}
    />
  </section>;
}

function PassageButton({ passage, recommended, selected, onClick }) {
  const state = passage.testedOut ? 'Tested out' : passage.complete ? 'Complete' : recommended ? 'Recommended' : 'Open';
  return (
    <button
      type="button"
      className={`piano-learn-roadmap__passage${selected ? ' is-selected' : ''}`}
      data-state={passage.complete ? 'complete' : recommended ? 'recommended' : 'open'}
      onClick={onClick}
    >
      <span>{passage.label}</span>
      <small>{state}</small>
    </button>
  );
}

export default function LearnRoadmap({
  passages, recommendedId, selectedId = null, onSelectPassage, onSelectRung, onClosePassage,
  customRange = null, measures = [], customResult = null, selectionPhase = null,
  onStartSelection, onCancelSelection, onPracticeCustom, onClearCustom,
}) {
  const selected = passages.find((passage) => passage.id === selectedId) ?? null;
  const customLabel = customRange && `Bars ${measures[customRange.inMeasure]?.number ?? customRange.inMeasure + 1}–${measures[customRange.outMeasure]?.number ?? customRange.outMeasure + 1}`;
  return (
    <section className="piano-learn-roadmap" aria-label="Learn roadmap">
      <header className="piano-learn-roadmap__header">
        <div><strong>Learn this piece</strong><span>Choose a passage or select your own bars.</span></div>
        <div className="piano-learn-roadmap__actions">
          {selectionPhase ? <button type="button" onClick={onCancelSelection}>Cancel selection</button>
            : <button type="button" onClick={onStartSelection}>Select bars</button>}
          {selected && <button type="button" onClick={onClosePassage}>All passages</button>}
        </div>
      </header>
      {selectionPhase && <p className="piano-learn-roadmap__selection-hint" role="status">
        {selectionPhase === 'in' ? 'Tap the first bar.' : 'Tap the last bar. You can drag either edge afterward.'}
      </p>}
      {customRange && !selected && !selectionPhase && <div className="piano-learn-roadmap__custom" aria-label="Custom practice selection">
        <strong>{customLabel}</strong>
        <span>Drag the score handles to adjust the bars.</span>
        {customResult && <span role="status">{customResult.verdict?.passed ? 'Passed' : 'Keep working'}</span>}
        <button type="button" onClick={onPracticeCustom}>Practice selection</button>
        <button type="button" onClick={onClearCustom}>Clear selection</button>
      </div>}
      {!selected ? (
        <div className="piano-learn-roadmap__passages">
          {passages.map((passage) => (
            <PassageButton key={passage.id} passage={passage} recommended={passage.id === recommendedId} onClick={() => onSelectPassage(passage.id)} />
          ))}
        </div>
      ) : (
        <div className="piano-learn-roadmap__ladder">
          <h3>{selected.label}</h3>
          {selected.rungs.map((rung) => (
            <button
              key={rung.id}
              type="button"
              disabled={rung.state === 'locked'}
              data-state={rung.state}
              onClick={() => onSelectRung(rung.id)}
            >
              <span>{rung.label}</span>
              <small>{rung.state === 'complete' ? 'Complete' : `${rung.passCount}/${rung.required} reps`}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
