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
        score={{ ...score, measures: passage.printedMeasures, rangeIndices: { start: passage.inMeasure, end: passage.outMeasure }, activeParts: rung.effectiveParts }}
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

export default function LearnRoadmap({ passages, recommendedId, selectedId = null, onSelectPassage, onSelectRung, onClosePassage }) {
  const selected = passages.find((passage) => passage.id === selectedId) ?? null;
  return (
    <section className="piano-learn-roadmap" aria-label="Learn roadmap">
      <header className="piano-learn-roadmap__header">
        <div><strong>Learn this piece</strong><span>Choose any passage. Work the ladder or test out.</span></div>
        {selected && <button type="button" onClick={onClosePassage}>All passages</button>}
      </header>
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
