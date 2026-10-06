import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import ExerciseRun from '../Exercises/ExerciseRun.jsx';
import RepInterstitial from '../Games/RepInterstitial.jsx';
import { SHEET_MUSIC_DEFAULTS } from './sheetMusicConfig.js';
import LearnTempoSheet from './LearnTempoSheet.jsx';
import { TEMPO_STAGES, availableTempoStages, nearestTempoStage } from './tempoStages.js';
import { CLICK_LEVELS, readClickLevel, writeClickLevel } from './clickLevel.js';
import getLogger from '../../../../../lib/logging/Logger.js';

const handCode = (parts) => parts.length > 1 ? 'RL' : parts[0] === 'lh' ? 'L' : parts[0] === 'rh' ? 'R' : null;
const clickStorage = () => {
  try { return globalThis.localStorage; }
  catch { return null; }
};

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

export default function LearnLab({ score, revision, segment, segments = {}, rung, creditRung = rung, tempo = {}, feedback = SHEET_MUSIC_DEFAULTS.learn.feedback, launchSource = 'recommended', creditEligible = true, onRecord, onClose, onChangePractice, onRungPassed, onMastered, onFinished, onUnavailable }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-learn-lab' }), []);
  const reactRunId = useId();
  const runIdRef = useRef(`learn-${reactRunId.replace(/[^a-z0-9_-]/gi, '')}`);
  const [take, setTake] = useState(0);
  const [success, setSuccess] = useState(null);
  const [repCard, setRepCard] = useState(null);
  const [runPassCount, setRunPassCount] = useState(rung.passCount ?? 0);
  const [paused, setPaused] = useState(false);
  const returnTimerRef = useRef(null);
  const masteryTempo = rung.mastery === true || rung.completion === 'tested-out';
  const setIndex = Math.min(rung.sets - 1, Math.floor(runPassCount / Math.max(1, rung.reps)));
  const configuredPercent = masteryTempo ? 100 : (rung.tempoPercents?.[setIndex] ?? rung.tempoPercent ?? 100);
  const [selectedPercent, setSelectedPercent] = useState(configuredPercent);
  const [tempoSheetOpen, setTempoSheetOpen] = useState(false);
  const [clickLevel, setClickLevel] = useState(() => readClickLevel(clickStorage()));
  const selectClickLevel = (level) => {
    setClickLevel(level);
    writeClickLevel(clickStorage(), level.id);
  };
  useEffect(() => { setSelectedPercent(configuredPercent); }, [configuredPercent]);
  const stages = useMemo(() => availableTempoStages({
    minimumPercent: tempo.minimumPercent, maximumPercent: tempo.maximumPercent,
  }), [tempo.minimumPercent, tempo.maximumPercent]);
  const stage = masteryTempo ? TEMPO_STAGES[TEMPO_STAGES.length - 1] : nearestTempoStage(selectedPercent, stages);
  const tempoPercent = ['cued', 'metronome'].includes(rung.mode) ? stage.percent : selectedPercent;
  const takeCreditEligible = creditEligible && tempoPercent === configuredPercent;
  const preferencesRef = useRef({ tempoStage: stage.id, tempoPercent, clickLevel: clickLevel.id });
  useEffect(() => {
    const previous = preferencesRef.current;
    const context = { scoreId: score.id, passageId: segment.id, rungId: rung.id };
    if (previous.tempoStage !== stage.id || previous.tempoPercent !== tempoPercent) {
      logger.info('piano.learn-tempo-stage-changed', { ...context,
        previousTempoStage: previous.tempoStage, previousTempoPercent: previous.tempoPercent,
        tempoStage: stage.id, tempoPercent });
    }
    if (previous.clickLevel !== clickLevel.id) {
      logger.info('piano.learn-click-level-changed', { ...context,
        previousClickLevel: previous.clickLevel, clickLevel: clickLevel.id, clickGain: clickLevel.gain });
    }
    preferencesRef.current = { tempoStage: stage.id, tempoPercent, clickLevel: clickLevel.id };
  }, [clickLevel, logger, rung.id, score.id, segment.id, stage.id, tempoPercent]);
  const runRung = useMemo(() => ({ ...rung, passCount: runPassCount }), [rung, runPassCount]);
  const projection = useMemo(() => learnDrillProjection(segment, runRung), [segment, runRung]);
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
  const currentRep = Math.min(Math.max(1, rung.reps), (runPassCount % Math.max(1, rung.reps)) + 1);
  useEffect(() => {
    const bpm = Number(tempo.tempoMap?.[0]?.bpm);
    logger.info('piano.learn.launch', {
      runId: runIdRef.current, scoreId: score.id, revision, passageId: segment.id, rungId: rung.id,
      mode: rung.mode, parts: [...(rung.effectiveParts ?? [])], tempoStage: stage.id, tempoPercent,
      effectiveBpm: bpm > 0 ? Math.round(bpm * tempoPercent / 100) : null, launchSource, creditEligible,
    });
  // A mounted lab is one launch. Selection changes restart the current take,
  // but do not manufacture a second launch event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const returnAfterSuccess = useCallback((callback) => {
    clearTimeout(returnTimerRef.current);
    returnTimerRef.current = setTimeout(callback, feedback.successReturnMs);
  }, [feedback.successReturnMs]);
  useEffect(() => () => clearTimeout(returnTimerRef.current), []);
  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === 'Escape' && !tempoSheetOpen) onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, tempoSheetOpen]);
  const recordResult = useCallback((result) => takeCreditEligible ? onRecord?.({
    revision, passageId: segment.id, rungId: creditRung.id, result,
    requiredPasses: creditRung.required, consecutive: creditRung.consecutive,
    completesPassage: creditRung.completes === 'passage', completion: creditRung.completion,
    segments,
  }) : null, [takeCreditEligible, creditRung, onRecord, revision, segment.id, segments]);
  const settle = useCallback((result) => {
    const outcome = recordResult(result);
    logger.info('piano.learn.terminal', {
      runId: runIdRef.current, scoreId: score.id, revision, passageId: segment.id, rungId: rung.id,
      mode: rung.mode, parts: [...(rung.effectiveParts ?? [])], tempoStage: stage.id, tempoPercent,
      status: 'passed', creditEligible: takeCreditEligible, creditOutcome: takeCreditEligible ? (outcome ? 'recorded' : 'not-recorded') : 'ineligible',
      right: result?.diagnostics?.matched_notes ?? null, wrong: result?.diagnostics?.wrong_notes ?? null,
      missed: result?.diagnostics?.missed_notes ?? null, early: result?.diagnostics?.early_notes ?? null,
      late: result?.diagnostics?.late_notes ?? null,
    });
    const nextPassCount = Math.min(rung.required, runPassCount + 1);
    setRunPassCount(nextPassCount);
    if (launchSource === 'recommended' && outcome?.passage?.complete) {
      onMastered?.(segment.id);
      if (onFinished) onFinished(result);
      else { setSuccess(`${segment.label} mastered`); returnAfterSuccess(onClose); }
    } else if (nextPassCount >= rung.required || outcome?.rungComplete) {
      if (outcome?.passage?.complete) onMastered?.(segment.id);
      if (onFinished) { onFinished(result); return; }
      setSuccess(`${rung.label} complete`);
      returnAfterSuccess(() => onRungPassed?.({ segmentId: segment.id, rungId: rung.id, outcome }));
    } else {
      const completedRep = Math.min(rung.reps, (runPassCount % rung.reps) + 1);
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
  }, [launchSource, logger, onClose, onFinished, onMastered, onRungPassed, recordResult, returnAfterSuccess, revision, rung, runPassCount, score.id, segment.id, segment.label, setIndex, stage.id, takeCreditEligible, tempoPercent]);
  const scoreBpm = Number(tempo.tempoMap?.[0]?.bpm);
  const effectiveBpm = scoreBpm > 0 ? Math.round(scoreBpm * tempoPercent / 100) : null;
  const controlContext = { runId: runIdRef.current, take, scoreId: score.id, revision, passageId: segment.id, rungId: rung.id,
    mode: rung.mode, parts: [...(rung.effectiveParts ?? [])], tempoStage: stage.id, tempoPercent, effectiveBpm, launchSource, creditEligible: takeCreditEligible };
  const logControl = (action) => logger.info('piano.learn.control', { ...controlContext, action });
  const adjustable = ['cued', 'metronome'].includes(rung.mode) && tempo.adjustable !== false && !masteryTempo;
  const tempoLabel = `${stage.label}${effectiveBpm ? ` · ${effectiveBpm} BPM` : ''}`;
  const abandonTake = (reason) => logger.info('piano.learn.take-abandoned', { ...controlContext, reason, creditOutcome: 'none' });
  const restartTake = (reason) => { abandonTake(reason); if (reason === 'restart') logControl('restart'); setPaused(false); setTake((value) => value + 1); };
  const changePractice = () => { abandonTake('change-practice'); logControl('change-practice'); onChangePractice?.({ parts: [...(rung.effectiveParts ?? [])], mode: rung.mode, tempoStage: stage.id, tempoPercent }); };
  const closeLab = () => { abandonTake('back'); onClose(); };
  const togglePaused = () => setPaused((value) => { logControl(value ? 'resume' : 'pause'); return !value; });
  const failTake = (result) => {
    const outcome = recordResult(result);
    logger.info('piano.learn.terminal', { ...controlContext, status: 'failed',
      creditOutcome: takeCreditEligible ? (outcome ? 'recorded' : 'not-recorded') : 'ineligible',
      right: result?.diagnostics?.matched_notes ?? null, wrong: result?.diagnostics?.wrong_notes ?? null,
      missed: result?.diagnostics?.missed_notes ?? null, early: result?.diagnostics?.early_notes ?? null,
      late: result?.diagnostics?.late_notes ?? null });
    if (launchSource !== 'recommended') onFinished?.(result);
  };

  return <section className="piano-learn-lab" role="dialog" aria-modal="true" aria-label={`${segment.label} · ${rung.label}`}>
    <header className="piano-learn-lab__toolbar">
      <button className="piano-learn-lab__back" type="button" onClick={closeLab} aria-label={`Back to ${segment.label}`}>
        <span aria-hidden="true">‹</span><span>Back</span>
      </button>
      <div className="piano-learn-lab__identity"><strong>{segment.label}</strong><span>{segment.barLabel}</span></div>
      <div className="piano-learn-lab__task"><strong>{rung.label}</strong><span>Set {setIndex + 1} of {rung.sets} · Rep {currentRep} of {rung.reps}</span></div>
      {['cued', 'metronome'].includes(rung.mode) && <div className="piano-learn-lab__tempo" role="status">
        {adjustable ? <button type="button" aria-label={`Choose tempo: ${tempoLabel}`} aria-haspopup="dialog" aria-expanded={tempoSheetOpen}
          onClick={() => setTempoSheetOpen(true)}><strong>{tempoLabel}</strong></button> : <strong>{tempoLabel}</strong>}
        <span>{tempo.tempoSource === 'musicxml' ? 'Score tempo' : 'Fallback tempo'}</span>
      </div>}
      {['cued', 'metronome'].includes(rung.mode) && <div className="piano-learn-lab__click-level" role="group" aria-label="Metronome loudness">
        <span>Click</span>
        {CLICK_LEVELS.map((level) => <button key={level.id} type="button" aria-pressed={clickLevel.id === level.id}
          onClick={() => selectClickLevel(level)}>{level.label}</button>)}
      </div>}
      <div className="piano-learn-lab__run-controls" role="group" aria-label="Practice controls">
        <button type="button" onClick={togglePaused}>{paused ? 'Resume' : 'Pause'}</button>
        <button type="button" onClick={() => restartTake('restart')}>Start over</button>
        <button type="button" onClick={changePractice}>Change practice</button>
      </div>
    </header>
    <ExerciseRun
      key={`${segment.id}:${rung.id}:${take}`} instance={null} score={runScore} intent="practice"
      practiceMode={rung.mode} practiceRequirement={requirement} programId={projection.id}
      clickGain={clickLevel.gain}
      stepId={projection.steps[stepIndex]?.id} drillProjection={projection}
      hideHeading scoreLayoutPolicy="whole-passage"
      framing={`${segment.label} · ${rung.label}`}
      ask={rung.mode === 'free' ? 'Play the passage accurately.' : 'Play the passage with the beat.'}
      traceContext={{ runId: runIdRef.current, take, tempoPercent, tempoStage: stage.id, clickLevel: clickLevel.id, tempoSource: tempo.tempoSource ?? 'inferred', launchSource }} surface="learn-lab"
      paused={paused} resumeDelayMs={effectiveBpm ? Math.round(120000 / effectiveBpm) : 1000} controlKey={take}
      persistInterrupted={false}
      scoreCursorPolicy="always" keyboardHintPolicy="after-wrong"
      failurePresentation="local" onExit={onClose} onPassed={settle}
      onFailed={failTake}
      onUnavailable={(reason, detail) => onUnavailable?.(detail || reason)}
    />
    {repCard && !success && <RepInterstitial {...repCard} onDone={() => setRepCard(null)} />}
    {success && <div className="piano-learn-lab__success" role="status"><strong>{success}</strong><span>Returning to the score…</span></div>}
    <LearnTempoSheet open={adjustable && tempoSheetOpen} stages={stages} selectedId={stage.id} effectiveBpm={effectiveBpm}
      onPick={(picked) => { setSelectedPercent(picked.percent); restartTake('tempo-change'); }} onClose={() => setTempoSheetOpen(false)} />
  </section>;
}
