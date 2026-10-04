/* eslint-disable react-refresh/only-export-components -- pure projections are exported beside their sole host for focused contract tests. */
import { useCallback, useMemo, useState } from 'react';
import ExerciseRun from '../Exercises/ExerciseRun.jsx';

const handCode = (parts) => {
  if (parts.length > 1) return 'RL';
  if (parts[0] === 'lh') return 'L';
  if (parts[0] === 'rh') return 'R';
  return null;
};

export function learnDrillProjection(passage, rung) {
  const reps = Math.max(1, rung.reps);
  const sets = Math.max(1, rung.sets);
  const banked = Math.max(0, rung.passCount ?? 0);
  const currentSet = Math.min(sets - 1, Math.floor(banked / reps));
  return {
    id: `learn:${passage.id}:${rung.id}`,
    title: rung.label,
    displaySingleStep: true,
    steps: Array.from({ length: sets }, (_, index) => {
      const passCount = Math.min(reps, Math.max(0, banked - index * reps));
      const passed = passCount >= reps;
      return {
        id: `${rung.id}:set-${index + 1}`,
        title: `Set ${index + 1}`,
        display: { key: `Set ${index + 1}`, hand: handCode(rung.effectiveParts), hand_label: rung.label },
        requirement: { required_passes: reps },
        pass_count: passCount,
        passed,
        state: passed ? 'complete' : index === currentSet ? 'current' : 'locked',
      };
    }),
  };
}

export function learnPracticeRequirement(rung) {
  return {
    mode: rung.mode,
    rubric: {
      id: 'sheet-music-learn-passage',
      version: '1',
      criteria: { ...(rung.criteria || {}) },
    },
  };
}

export function LearnPassageSession({ score, revision, passage, rung, onRecord, onBack }) {
  const [take, setTake] = useState(0);
  const projection = useMemo(() => learnDrillProjection(passage, rung), [passage, rung]);
  const requirement = useMemo(() => learnPracticeRequirement(rung), [rung]);
  const printedStart = passage.printedMeasures?.[0] ?? null;
  const printedEnd = passage.printedMeasures?.[1] ?? null;
  const partsKey = (rung.effectiveParts ?? []).join('\u0000');
  const runScore = useMemo(() => ({
    ...score,
    measures: [printedStart, printedEnd],
    rangeIndices: { start: passage.inMeasure, end: passage.outMeasure },
    activeParts: partsKey ? partsKey.split('\u0000') : [],
  }), [score, printedStart, printedEnd, passage.inMeasure, passage.outMeasure, partsKey]);
  const stepIndex = Math.min(rung.sets - 1, Math.floor((rung.passCount ?? 0) / Math.max(1, rung.reps)));
  const settle = useCallback((result) => {
    const outcome = onRecord({
      revision,
      passageId: passage.id,
      rungId: rung.id,
      result,
      requiredPasses: rung.required,
      consecutive: rung.consecutive,
      completesPassage: rung.completes === 'passage',
      completion: rung.completion,
    });
    if (outcome?.rungComplete || outcome?.passage?.complete) onBack();
    else setTake((value) => value + 1);
  }, [onBack, onRecord, passage.id, revision, rung]);

  return (
    <div className="piano-learn-session">
      <button className="piano-learn-session__back" type="button" onClick={onBack}>Back to roadmap</button>
      <ExerciseRun
        key={`${passage.id}:${rung.id}:${take}`}
        instance={null}
        score={runScore}
        intent="practice"
        practiceMode={rung.mode}
        practiceRequirement={requirement}
        programId={projection.id}
        stepId={projection.steps[stepIndex]?.id}
        drillProjection={projection}
        framing={`${passage.label} · ${rung.label}`}
        ask={rung.mode === 'free' ? 'Play the passage accurately.' : 'Play the passage with the beat.'}
        bare
        onExit={onBack}
        onPassed={settle}
        onFailed={settle}
        onUnavailable={onBack}
      />
    </div>
  );
}

/** Self-directed practice never writes the preset passage ladder. */
export function CustomLearnSession({ score, range, measures = [], activeParts = ['rh', 'lh'], onResult, onBack }) {
  const start = measures[range.inMeasure]?.number ?? range.inMeasure + 1;
  const end = measures[range.outMeasure]?.number ?? range.outMeasure + 1;
  const label = `Bars ${start}–${end}`;
  return <div className="piano-learn-session">
    <button className="piano-learn-session__back" type="button" onClick={onBack}>Back to selection</button>
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
      bare
      onExit={onBack}
      onPassed={onResult}
      onFailed={onResult}
      onUnavailable={onBack}
    />
  </div>;
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
