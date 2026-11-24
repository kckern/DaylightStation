import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import ExerciseRun from '../Exercises/ExerciseRun.jsx';
import RepInterstitial from '../Games/RepInterstitial.jsx';
import { SHEET_MUSIC_DEFAULTS } from './sheetMusicConfig.js';
import LearnTempoTrack from './LearnTempoTrack.jsx';
import LearnClickVolume from './LearnClickVolume.jsx';
import { TEMPO_STAGES, availableTempoStages, nearestTempoStage } from './tempoStages.js';
import { readClickLevel, writeClickLevel } from './clickLevel.js';
import Icon from '../../../ui/icons/Icon.jsx';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { useRhythmVoice } from './useRhythmVoice.js';
import { toRhythmMusicXml } from '../Exercises/rhythmOnly.js';
import { entryShiftBeats } from '../../../../../../../shared/music/learnCoach.mjs';

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
export function learnPracticeRequirement(rung, tempoPercent = rung.tempoPercent) {
  const criteria = { ...(rung.criteria || {}) };
  if (rung.mode === 'free' && criteria.cleanliness == null) criteria.cleanliness = 0.8;
  const policy = {
    ...((rung.effectiveParts?.length ?? 0) > 1 ? { requireConcurrentOnset: true } : {}),
    ...(learningTempoTake(rung, tempoPercent) ? { placementFullCreditShare: LEARNING_PLACEMENT_SHARE } : {}),
  };
  return {
    mode: rung.mode,
    rubric: { id: 'sheet-music-learn-passage', version: '2', criteria },
    ...(Object.keys(policy).length ? { policy } : {}),
  };
}

/**
 * A cued take below score tempo (the 50 / 60 / 75% steps, a slower-beat
 * recovery, an authored slower stage) is where a child learns to play with the
 * click, and those takes were grading a steady 190 ms lag at 84 bpm (a quarter
 * of a beat, every note inside its window) as a fail. Full credit there reaches
 * 60% of each note's window instead of 40%; a note outside the window still
 * earns nothing. Score tempo (Gold) and test-out keep the strict curve.
 *
 * The tempo is the one the take is PLAYED at (`tempoPercent`), not the rung's
 * configured one: a rung set per set (`tempoPercents`), a coached task's own
 * tempo, or a stage the child picked all change it.
 * ops:docs/_wip/audits/2026-11-20-sheetmusic-learn-take-ux-audit.md
 */
const LEARNING_PLACEMENT_SHARE = 0.6;
function learningTempoTake(rung, tempoPercent) {
  if (rung.mode !== 'cued') return false;
  if (rung.mastery === true || rung.completion === 'tested-out' || rung.id === 'mastery' || rung.id === 'test-out') return false;
  const percent = Number(tempoPercent);
  return tempoPercent != null && Number.isFinite(percent) && percent < 100;
}

export default function LearnLab({ score, revision, segment, segments = {}, rung, creditRung = rung, tempo = {}, feedback = SHEET_MUSIC_DEFAULTS.learn.feedback, launchSource = 'recommended', creditEligible = true, startOnReady = false, coachingTask = null, drill = null, card = null, ceremony = null, onCardDone, notice = null, extraControls = null, resultLabel = null, resultActions = null, resultContinueLabel = null, onResultContinue = null, onPickStep = null, onListen = null, tempoChoice = null, onStarted, onOutcome, onRecord, onClose, onChangePractice, onRungPassed, onMastered, onFinished, onUnavailable, maxCueRestarts }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-learn-lab' }), []);
  const reactRunId = useId();
  const runIdRef = useRef(`learn-${reactRunId.replace(/[^a-z0-9_-]/gi, '')}`);
  const outcomeReported = useRef(false);
  const reportOutcome = (result, meta) => { if (!outcomeReported.current) { outcomeReported.current = true; onOutcome?.(result, meta); } };
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
  // What the run is doing (ExerciseRun `onPhase`), so the header offers only what makes sense now.
  const [runPhase, setRunPhase] = useState('ready');
  // Listen: null, or the demonstration 'playing' / 'paused' inside the drill.
  const [listening, setListening] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const takeUnderWay = ['countdown', 'running', 'resume-countdown'].includes(runPhase);
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
  // A coached step's tempo is its own unless the child chose another on the header's track (the coach
  // keeps the choice, `tempoChoice`); a take is always played, graded and recorded at the tempo chosen.
  const tempoPercent = coachingTask ? (tempoChoice?.value ?? coachingTask.tempoPercent ?? 100) : ['cued', 'metronome'].includes(rung.mode) ? stage.percent : selectedPercent;
  const configuredStagePercent = masteryTempo ? 100 : nearestTempoStage(configuredPercent, stages).percent;
  // A take at or above the stage it was set credits it (a pass at a faster tempo counts for every rung at or below it).
  const takeCreditEligible = creditEligible && tempoPercent >= configuredStagePercent;
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
  // A coached passage brings its own sets: one per Silver or Gold step.
  const ownProjection = useMemo(() => learnDrillProjection(segment, runRung), [segment, runRung]);
  const projection = drill?.projection ?? ownProjection;
  const requirement = useMemo(() => learnPracticeRequirement(rung, tempoPercent), [rung, tempoPercent]);
  // The rhythm recovery rung: any key, a percussive voice while it lasts (restored on leaving).
  const rhythm = coachingTask?.rhythm === true;
  useRhythmVoice(rhythm);
  // Recorded with each take, so placement scores judged on the wider share can
  // be told from those judged on the strict curve. Null when not applied.
  const placementShare = requirement.policy?.placementFullCreditShare ?? null;
  const partsKey = (rung.effectiveParts ?? []).join('\u0000');
  const baseRunScore = useMemo(() => ({
    ...score,
    measures: segment.printedMeasures ?? [null, null],
    rangeIndices: { start: segment.inMeasure, end: segment.outMeasure },
    activeParts: partsKey ? partsKey.split('\u0000') : [],
    tempoPercent,
  }), [score, segment.printedMeasures, segment.inMeasure, segment.outMeasure, partsKey, tempoPercent]);
  // The rhythm step and rung draw the passage as rhythm only: one line per staff, X noteheads (rhythmOnly.js).
  const runScore = useMemo(() => (coachingTask?.rhythm === true && typeof baseRunScore.musicXml === 'string'
    ? { ...baseRunScore, musicXml: toRhythmMusicXml(baseRunScore.musicXml) } : baseRunScore), [baseRunScore, coachingTask?.rhythm]);
  const stepIndex = setIndex;
  const passageName = coachingTask ? (segment.barLabel ?? segment.label) : segment.label;
  // A take replayed from the piano is a new take, reported in its own right.
  const takeStarted = () => { outcomeReported.current = false; onStarted?.(); };
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
    // An open sheet takes its own Escape (TransportSheet); only then is it the drill's.
    const handleKeyDown = (event) => { if (event.key === 'Escape' && !sheetOpen) onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, sheetOpen]);
  const recordResult = useCallback((result) => takeCreditEligible ? onRecord?.({
    revision, passageId: segment.id, rungId: creditRung.id, result,
    requiredPasses: creditRung.required, consecutive: creditRung.consecutive,
    completesPassage: creditRung.completes === 'passage', completion: creditRung.completion,
    segments,
  }) : null, [takeCreditEligible, creditRung, onRecord, revision, segment.id, segments]);
  const settle = useCallback((result) => {
    if (coachingTask) { reportOutcome(result, { placementShare, tempoPercent }); return; }
    const outcome = recordResult(result);
    logger.info('piano.learn.terminal', {
      runId: runIdRef.current, scoreId: score.id, revision, passageId: segment.id, rungId: rung.id,
      mode: rung.mode, parts: [...(rung.effectiveParts ?? [])], tempoStage: stage.id, tempoPercent,
      status: 'passed', placementShare, creditEligible: takeCreditEligible, creditOutcome: takeCreditEligible ? (outcome ? 'recorded' : 'not-recorded') : 'ineligible',
      right: result?.diagnostics?.matched_notes ?? null, wrong: result?.diagnostics?.wrong_notes ?? null,
      missed: result?.diagnostics?.missed_notes ?? null, early: result?.diagnostics?.early_notes ?? null,
      late: result?.diagnostics?.late_notes ?? null, entryShiftBeats: entryShiftBeats(result),
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
  }, [coachingTask, onOutcome, placementShare, tempoPercent, launchSource, logger, onClose, onFinished, onMastered, onRungPassed, recordResult, returnAfterSuccess, revision, rung, runPassCount, score.id, segment.id, segment.label, setIndex, stage.id, takeCreditEligible]);
  const scoreBpm = Number(tempo.tempoMap?.[0]?.bpm);
  const effectiveBpm = scoreBpm > 0 ? Math.round(scoreBpm * tempoPercent / 100) : null;
  const controlContext = { runId: runIdRef.current, take, scoreId: score.id, revision, passageId: segment.id, rungId: rung.id,
    mode: rung.mode, parts: [...(rung.effectiveParts ?? [])], tempoStage: stage.id, tempoPercent, effectiveBpm, launchSource, creditEligible: takeCreditEligible };
  const logControl = (action) => logger.info('piano.learn.control', { ...controlContext, action });
  const timedMode = ['cued', 'metronome'].includes(rung.mode);
  const adjustable = !coachingTask && timedMode && tempo.adjustable !== false && !masteryTempo;
  // The track: a coach hands its stops (the plan's own rung tempos); a plain rung offers its stages.
  const track = coachingTask ? (timedMode && tempoChoice ? tempoChoice : null)
    : adjustable ? { stops: stages.map((item) => item.percent), ladder: stages.map((item) => item.percent), earned: [], stepPercent: configuredStagePercent, value: stage.percent,
      onChange: (percent) => { setSelectedPercent(percent); restartTake('tempo-change'); } } : null;
  const abandonTake = (reason) => logger.info('piano.learn.take-abandoned', { ...controlContext, reason, creditOutcome: 'none' });
  const restartTake = (reason) => { abandonTake(reason); if (reason === 'restart') logControl('restart'); setPaused(false); setListening(null); setTake((value) => value + 1); };
  const chooseTempo = (percent) => {
    logger.info('piano.learn.tempo.choose', { ...controlContext, from: tempoPercent, to: percent, step: rung.id, stepPercent: track?.stepPercent ?? null });
    track.onChange(percent);
  };
  // From a finished take, Listen starts from a fresh run (the result's slot becomes the progress bar).
  const listen = () => { logControl('listen'); if (runPhase === 'done') setTake((value) => value + 1); setListening('playing'); onListen?.(); };
  const stopListening = (reason) => { logger.info('piano.learn.listen.stop', { ...controlContext, reason }); setListening(null); };
  const changePractice = () => { abandonTake('change-practice'); logControl('change-practice'); onChangePractice?.({ parts: [...(rung.effectiveParts ?? [])], mode: rung.mode, tempoStage: stage.id, tempoPercent }); };
  const closeLab = () => { abandonTake('back'); onClose(); };
  const togglePaused = () => setPaused((value) => { logControl(value ? 'resume' : 'pause'); return !value; });
  const failTake = (result) => {
    if (coachingTask) { reportOutcome(result, { placementShare, tempoPercent }); return; }
    const outcome = recordResult(result);
    logger.info('piano.learn.terminal', { ...controlContext, status: 'failed', placementShare,
      creditOutcome: takeCreditEligible ? (outcome ? 'recorded' : 'not-recorded') : 'ineligible',
      right: result?.diagnostics?.matched_notes ?? null, wrong: result?.diagnostics?.wrong_notes ?? null,
      missed: result?.diagnostics?.missed_notes ?? null, early: result?.diagnostics?.early_notes ?? null,
      late: result?.diagnostics?.late_notes ?? null,
      // A whole-beat shifted entry ExerciseRun tested for: ±k, 0 none, null untested.
      entryShiftBeats: entryShiftBeats(result) });
    if (launchSource !== 'recommended') onFinished?.(result);
  };

  return <section className={`piano-learn-lab${coachingTask ? ' piano-learn-lab--coach' : ''}`} role="dialog" aria-modal="true" aria-label={`${passageName} · ${rung.label}`}>
    <header className="piano-learn-lab__toolbar">
      <button className="piano-learn-lab__back" type="button" onClick={closeLab} aria-label={coachingTask ? 'Back to score' : `Back to ${segment.label}`}>
        <span aria-hidden="true">‹</span><span>Back</span>
      </button>
      <div className="piano-learn-lab__identity">{coachingTask ? <strong>{passageName}</strong> : <><strong>{segment.label}</strong><span>{segment.barLabel}</span></>}</div>
      <div className="piano-learn-lab__task"><strong>{rung.label}</strong>{!coachingTask && <span>Set {setIndex + 1} of {rung.sets} · Rep {currentRep} of {rung.reps}</span>}</div>
      {track && <LearnTempoTrack stops={track.stops} ladder={track.ladder} earned={track.earned} value={tempoPercent} stepPercent={track.stepPercent}
        scoreBpm={scoreBpm > 0 ? scoreBpm : null} locked={takeUnderWay || Boolean(listening)} onChange={chooseTempo} />}
      {timedMode && <LearnClickVolume level={clickLevel} onChange={selectClickLevel} onOpenChange={setSheetOpen} />}
      {notice}
      {/* One button per thing that can be done NOW: before a take, Listen; during one, Pause; paused,
          Resume and Start over; listening, Pause or Play and Stop. The row keeps its place. */}
      <div className="piano-learn-lab__run-controls" role="group" aria-label="Practice controls" data-phase={listening ? 'listening' : runPhase}>
        {listening ? <>
          <button type="button" className="piano-learn-lab__action" onClick={() => { logControl(listening === 'playing' ? 'listen-pause' : 'listen-play'); setListening(listening === 'playing' ? 'paused' : 'playing'); }}>
            <Icon name={listening === 'playing' ? 'pause' : 'play'} /><span>{listening === 'playing' ? 'Pause' : 'Play'}</span></button>
          <button type="button" className="piano-learn-lab__action" onClick={() => stopListening('stop')}><Icon name="stop" /><span>Stop</span></button>
        </> : runPhase === 'paused' ? <>
          <button type="button" className="piano-learn-lab__action" onClick={togglePaused}><Icon name="play" /><span>Resume</span></button>
          <button type="button" className="piano-learn-lab__action" onClick={() => restartTake('restart')}><Icon name="restart" /><span>Start over</span></button>
        </> : takeUnderWay ? <button type="button" className="piano-learn-lab__action" onClick={togglePaused}><Icon name="pause" /><span>Pause</span></button>
          : ['ready', 'done'].includes(runPhase) ? <>
            {onListen && <button type="button" className="piano-learn-lab__action" onClick={listen}><Icon name="listen" /><span>Listen</span></button>}
            {onChangePractice && <button type="button" className="piano-learn-lab__action" onClick={changePractice}><span>Change practice</span></button>}
            {extraControls}
          </> : null}
      </div>
    </header>
    <ExerciseRun rhythmOnly={rhythm} {...(maxCueRestarts != null ? { maxCueRestarts } : {})}
      key={`${segment.id}:${rung.id}:${take}:${tempoPercent}`} instance={null} score={runScore} intent="practice"
      practiceMode={rung.mode} practiceRequirement={requirement} programId={projection.id}
      leadInLoop={rung.mode === 'cued' && coachingTask?.leadIn === true && !rhythm}
      clickGain={clickLevel.gain}
      stepId={drill ? drill.stepId : projection.steps[stepIndex]?.id} drillProjection={projection}
      hideHeading scoreLayoutPolicy="whole-passage"
      framing={`${passageName} · ${rung.label}`}
      ask={rhythm ? 'Tap the rhythm on any key.' : rung.mode === 'free' ? 'Play the passage accurately.' : 'Play the passage with the beat.'}
      traceContext={{ runId: runIdRef.current, take, tempoPercent, tempoStage: stage.id, clickLevel: clickLevel.id, tempoSource: tempo.tempoSource ?? 'inferred', launchSource }} surface="learn-lab"
      paused={paused} resumeDelayMs={effectiveBpm ? Math.round(120000 / effectiveBpm) : 1000} controlKey={take}
      startOnReady={startOnReady}
      persistInterrupted={false} persistAssessment={!coachingTask}
      scoreCursorPolicy="always" keyboardHintPolicy={coachingTask?.assist === 'none' || rhythm ? 'never' : 'after-wrong'}
      incompleteAfterMs={coachingTask?.assist === 'none' && coachingTask.stallSeconds ? coachingTask.stallSeconds * 1000 : null}
      failurePresentation="local" resultPresentation="docked" resultLabel={resultLabel} resultActions={resultActions} resultContinueLabel={resultContinueLabel} onResultContinue={onResultContinue} onPickStep={onPickStep} onStarted={takeStarted} onExit={onClose} onPassed={settle}
      onFailed={failTake} onPhase={setRunPhase}
      demonstration={listening ? { playing: listening === 'playing', onDone: () => stopListening('end') } : null}
      onUnavailable={(reason, detail) => onUnavailable?.(detail || reason)}
    />
    {repCard && !success && <RepInterstitial {...repCard} onDone={() => setRepCard(null)} />}
    {card && <RepInterstitial key={card.id} {...card} onDone={onCardDone} />}
    {ceremony}
    {success && <div className="piano-learn-lab__success" role="status"><strong>{success}</strong><span>Returning to the score…</span></div>}
  </section>;
}
