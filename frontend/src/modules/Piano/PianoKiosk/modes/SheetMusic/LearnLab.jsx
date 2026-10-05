import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ExerciseRun from '../Exercises/ExerciseRun.jsx';
import RepInterstitial from '../Games/RepInterstitial.jsx';
import { SHEET_MUSIC_DEFAULTS } from './sheetMusicConfig.js';

const handCode = (parts) => parts.length > 1 ? 'RL' : parts[0] === 'lh' ? 'L' : parts[0] === 'rh' ? 'R' : null;

// eslint-disable-next-line react-refresh/only-export-components -- pure projection is exported for focused contract tests
export function learnDrillProjection(segment, rung) {
  const reps = Math.max(1, rung.reps);
  const sets = Math.max(1, rung.sets);
  const banked = Math.max(0, rung.passCount ?? 0);
  const currentSet = Math.min(sets - 1, Math.floor(banked / reps));
  return {
    id: `learn:${segment.id}:${rung.id}`,
    title: rung.label,
    displaySingleStep: true,
    steps: Array.from({ length: sets }, (_, index) => {
      const passCount = Math.min(reps, Math.max(0, banked - index * reps));
      const passed = passCount >= reps;
      return {
        id: `${rung.id}:set-${index + 1}`,
        title: `Set ${index + 1}`,
        display: { key: `Set ${index + 1}`, hand: handCode(rung.effectiveParts), hand_label: rung.label },
        requirement: { required_passes: reps }, pass_count: passCount, passed,
        state: passed ? 'complete' : index === currentSet ? 'current' : 'locked',
      };
    }),
  };
}

// eslint-disable-next-line react-refresh/only-export-components -- pure adapter is exported for focused contract tests
export function learnPracticeRequirement(rung) {
  const criteria = { ...(rung.criteria || {}) };
  if (rung.mode === 'free' && criteria.cleanliness == null) criteria.cleanliness = 0.8;
  return {
    mode: rung.mode,
    rubric: { id: 'sheet-music-learn-passage', version: '2', criteria },
    ...((rung.effectiveParts?.length ?? 0) > 1 ? { policy: { requireConcurrentOnset: true } } : {}),
  };
}

export default function LearnLab({ score, revision, segment, segments = {}, rung, tempo = {}, feedback = SHEET_MUSIC_DEFAULTS.learn.feedback, onRecord, onClose, onRungPassed, onMastered, onUnavailable }) {
  const [take, setTake] = useState(0);
  const [success, setSuccess] = useState(null);
  const [repCard, setRepCard] = useState(null);
  const returnTimerRef = useRef(null);
  const masteryTempo = rung.mastery === true || rung.completion === 'tested-out';
  const setIndex = Math.min(rung.sets - 1, Math.floor((rung.passCount ?? 0) / Math.max(1, rung.reps)));
  const configuredPercent = masteryTempo ? 100 : (rung.tempoPercents?.[setIndex] ?? rung.tempoPercent ?? 100);
  const [tempoPercent, setTempoPercent] = useState(configuredPercent);
  useEffect(() => { setTempoPercent(configuredPercent); }, [configuredPercent]);
  const projection = useMemo(() => learnDrillProjection(segment, rung), [segment, rung]);
  const requirement = useMemo(() => learnPracticeRequirement(rung), [rung]);
  const partsKey = (rung.effectiveParts ?? []).join('\u0000');
  const runScore = useMemo(() => ({
    ...score,
    measures: segment.printedMeasures ?? [null, null],
    rangeIndices: { start: segment.inMeasure, end: segment.outMeasure },
    activeParts: partsKey ? partsKey.split('\u0000') : [],
    tempoPercent,
  }), [score, segment.printedMeasures, segment.inMeasure, segment.outMeasure, partsKey, tempoPercent]);
  const stepIndex = setIndex;
  const currentRep = Math.min(Math.max(1, rung.reps), ((rung.passCount ?? 0) % Math.max(1, rung.reps)) + 1);
  const returnAfterSuccess = useCallback((callback) => {
    clearTimeout(returnTimerRef.current);
    returnTimerRef.current = setTimeout(callback, feedback.successReturnMs);
  }, [feedback.successReturnMs]);
  useEffect(() => () => clearTimeout(returnTimerRef.current), []);
  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  const recordResult = useCallback((result) => onRecord({
    revision, passageId: segment.id, rungId: rung.id, result,
    requiredPasses: rung.required, consecutive: rung.consecutive,
    completesPassage: rung.completes === 'passage', completion: rung.completion,
    segments,
  }), [onRecord, revision, rung, segment.id, segments]);
  const settle = useCallback((result) => {
    const outcome = recordResult(result);
    if (outcome?.passage?.complete) {
      onMastered?.(segment.id);
      setSuccess(`${segment.label} mastered`);
      returnAfterSuccess(onClose);
    } else if (outcome?.rungComplete) {
      setSuccess(`${rung.label} complete`);
      returnAfterSuccess(() => onRungPassed?.({ segmentId: segment.id, rungId: rung.id, outcome }));
    } else {
      const completedRep = Math.min(rung.reps, ((rung.passCount ?? 0) % rung.reps) + 1);
      const setClear = completedRep >= rung.reps;
      setRepCard({
        score: result?.score ?? null,
        setIndex: setIndex + 1,
        setCount: rung.sets,
        repIndex: completedRep,
        repCount: rung.reps,
        setClear,
        next: setClear
          ? { key: `Set ${Math.min(rung.sets, setIndex + 2)}`, hand: handCode(rung.effectiveParts) }
          : null,
      });
      setTake((value) => value + 1);
    }
  }, [onClose, onMastered, onRungPassed, recordResult, returnAfterSuccess, rung, segment.id, segment.label, setIndex]);
  const scoreBpm = Number(tempo.tempoMap?.[0]?.bpm);
  const effectiveBpm = scoreBpm > 0 ? Math.round(scoreBpm * tempoPercent / 100) : null;
  const adjustable = rung.mode === 'cued' && tempo.adjustable !== false && !masteryTempo;
  const minimumPercent = tempo.minimumPercent ?? 40;
  const maximumPercent = tempo.maximumPercent ?? 100;

  return <section className="piano-learn-lab" role="dialog" aria-modal="true" aria-label={`${segment.label} · ${rung.label}`}>
    <header className="piano-learn-lab__toolbar">
      <button className="piano-learn-lab__back" type="button" onClick={onClose} aria-label={`Back to ${segment.label}`}>
        <span aria-hidden="true">‹</span><span>Back</span>
      </button>
      <div className="piano-learn-lab__identity"><strong>{segment.label}</strong><span>{segment.barLabel}</span></div>
      <div className="piano-learn-lab__task"><strong>{rung.label}</strong><span>Set {setIndex + 1} of {rung.sets} · Rep {currentRep} of {rung.reps}</span></div>
      {rung.mode === 'cued' && <div className="piano-learn-lab__tempo" role="status">
        {adjustable && <button type="button" aria-label="Decrease tempo" disabled={tempoPercent <= minimumPercent}
          onClick={() => setTempoPercent((value) => Math.max(minimumPercent, value - 5))}>−</button>}
        <strong>{tempoPercent}% of {tempo.tempoSource === 'musicxml' ? 'score tempo' : 'fallback tempo'}{effectiveBpm ? ` · ${effectiveBpm} BPM` : ''}</strong>
        {adjustable && <button type="button" aria-label="Increase tempo" disabled={tempoPercent >= maximumPercent}
          onClick={() => setTempoPercent((value) => Math.min(maximumPercent, value + 5))}>+</button>}
      </div>}
    </header>
    <ExerciseRun
      key={`${segment.id}:${rung.id}:${take}`} instance={null} score={runScore} intent="practice"
      practiceMode={rung.mode} practiceRequirement={requirement} programId={projection.id}
      stepId={projection.steps[stepIndex]?.id} drillProjection={projection}
      framing={`${segment.label} · ${rung.label}`}
      ask={rung.mode === 'free' ? 'Play the passage accurately.' : 'Play the passage with the beat.'}
      traceContext={{ tempoPercent, tempoSource: tempo.tempoSource ?? 'inferred' }} surface="learn-lab"
      scoreCursorPolicy="always" keyboardHintPolicy="after-wrong"
      failurePresentation="local" onExit={onClose} onPassed={settle}
      onFailed={recordResult}
      onUnavailable={(reason, detail) => onUnavailable?.(detail || reason)}
    />
    {repCard && !success && <RepInterstitial {...repCard} onDone={() => setRepCard(null)} />}
    {success && <div className="piano-learn-lab__success" role="status"><strong>{success}</strong><span>Returning to the score…</span></div>}
  </section>;
}
