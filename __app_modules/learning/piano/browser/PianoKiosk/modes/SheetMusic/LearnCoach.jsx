import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { coachFeedback, isGoldWork, makeCoachTask } from '../../../../../../../shared/music/learnCoach.mjs';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import useLearnCoach from './useLearnCoach.js';
import usePieceGemOffer from './usePieceGemOffer.js';
import LearnLab from './LearnLab.jsx';
import LearnListen from './LearnListen.jsx';
import LearnLaunchpad from './LearnLaunchpad.jsx';
import PassageRail from './PassageRail.jsx';
import PassageBoard from './PassageBoard.jsx';
import { PassageTurn } from './PassageCoin.jsx';
import { railModel } from './passageRail.js';
import ScorePassage from '../Exercises/ScorePassage.jsx';
import './LearnCoach.scss';

const EMPTY = {};
/** What a step is called under its pills: a set label, not a sentence. */
const SET_NAMES = Object.freeze({ right: 'Right hand', left: 'Left hand', together: 'Together', notes: 'Notes', silver: 'On your own',
  pulse: 'Beat', 'timed-60': '60%', 'timed-80': '80%', mastery: '100%' });
const setName = (task) => SET_NAMES[task.skill] ?? task.label;
const barsOf = (passage) => passage?.barLabel ?? passage?.label ?? '';
const lower = (label) => label.charAt(0).toLowerCase() + label.slice(1);
/** The plan step a task belongs to: itself, or the step a recovery drill came from. */
const rootOf = (task) => { let at = task; while (at?.parent) at = at.parent; return at; };
const freshId = () => `coach-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/**
 * A passage's steps as the drill surface draws a program: every Silver and
 * Gold step is a set, and the clean takes it needs are its reps.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure projection is exported for focused contract tests
export function passageDrill(passage, task) {
  const current = rootOf(task)?.key ?? null;
  const steps = (passage?.skills ?? []).map((skill) => {
    // A step with no fixed count is earned by two good takes out of the last three.
    const reps = Math.max(1, skill.required ?? 2);
    const banked = skill.ready ? reps : Math.min(reps - 1, skill.successes ?? 0);
    return { id: skill.key, title: skill.label, display: { key: setName(skill), hand: null, hand_label: null },
      requirement: { required_passes: reps }, pass_count: banked, passed: Boolean(skill.ready),
      state: skill.ready ? 'complete' : skill.key === current ? 'current' : 'locked' };
  });
  return { projection: { id: `learn:${passage?.id}`, title: barsOf(passage), displaySingleStep: true, steps },
    stepId: steps.some((step) => step.id === current) ? current : null };
}

// The key makes profile/passage transitions dispose the old lab and its resolve hold.
export default function LearnCoach(props) {
  if (!props.coach) return <OwnedCoach {...props} />;
  const coach = props.coach;
  return <CoachSession key={`${coach.profileId}:${props.plan.fingerprint}:${props.segment.id}`} {...props} coach={coach} />;
}

function OwnedCoach(props) {
  const coach = useLearnCoach({ plan: props.plan, legacy: props.legacy ?? EMPTY });
  return <LearnCoach {...props} coach={coach} />;
}

/**
 * Glue between the coach and the drill surface. It chooses the step, hands the
 * passage to LearnLab as a drill of sets and reps, records each take, and puts
 * the passage rail and board under it. It draws no practice screen of its own.
 */
function CoachSession({ score, title, plan, segment, coach, tempo = EMPTY, feedback, onBack, onPassageChange, onListen }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-learn-coach' }), []);
  const [view, setView] = useState('play'); // play | listen | custom
  const [choice, setChoice] = useState(null);
  const [selected, setSelected] = useState(null);
  const [lane, setLane] = useState(null); // 'gold' once the child is working on Gold here
  const [run, setRun] = useState(null); // the task of a take that has begun
  const [result, setResult] = useState(null); // the last finished take, until the next one begins
  const [moment, setMoment] = useState(null); // the pass being celebrated
  const [runNumber, setRunNumber] = useState(0);
  const [board, setBoard] = useState(null); // null, or { focusId }
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const projected = coach.projection.segments.find((item) => item.id === segment.id);
  const recommended = coach.projection.recommended?.passageId === segment.id ? coach.projection.recommended : null;
  const certification = projected?.certification ?? {};
  const goldDrill = coach.projection.goldResume?.passageId === segment.id ? coach.projection.goldResume : null;
  const goldNext = coach.projection.gold?.[segment.id] ?? null;
  const silverTask = projected?.skills.find((skill) => skill.assist === 'none') ?? null;
  const silverNext = recommended ?? projected?.skills.find((task) => task.track === 'silver' && !task.ready);
  const next = (lane === 'gold' ? goldDrill ?? goldNext : null) ?? silverNext ?? goldDrill ?? goldNext
    ?? projected?.skills.find((task) => !task.ready) ?? segment.tasks?.at(-1) ?? null;
  const task = run ?? selected ?? next;
  const taskRef = useRef(task); taskRef.current = task;
  const piece = coach.projection.piece;
  const loaded = coach.loaded !== false;

  // Save acknowledgements change the projection, never the material of a live take.
  const material = useMemo(() => {
    const wanted = taskRef.current;
    if (!wanted) return null;
    const canonical = plan.segments.find((item) => item.id === wanted.passageId) ?? segment;
    // A drill on part of the passage is named by the bars it covers.
    const whole = wanted.range.start === segment.inMeasure && wanted.range.end === segment.outMeasure;
    const barLabel = whole ? segment.barLabel : wanted.range.start === wanted.range.end ? `Bar ${wanted.range.start + 1}` : `Bars ${wanted.range.start + 1}–${wanted.range.end + 1}`;
    return { segment: { ...canonical, barLabel, inMeasure: wanted.range.start, outMeasure: wanted.range.end },
      rung: { id: wanted.skill, label: wanted.label, effectiveParts: wanted.parts, mode: wanted.mode,
        tempoPercent: wanted.tempoPercent, criteria: wanted.criteria, sets: 1, reps: 1, required: 1, passCount: 0 } };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the task's identity, not the projection's fresh objects
  }, [plan, segment.barLabel, segment.inMeasure, segment.outMeasure, task?.key, runNumber]);
  const drill = useMemo(() => passageDrill(projected, task), [projected, task]);

  useEffect(() => {
    logger.info('piano.learn.coach.step', { scoreId: score.id, passageId: segment.id, skill: task?.skill ?? null,
      mode: task?.mode ?? null, depth: task?.depth ?? 0, view });
  }, [logger, score.id, segment.id, task?.key, task?.skill, task?.mode, task?.depth, view]);

  const begin = (wanted) => {
    setSelected(wanted ?? null); setRun(null); setResult(null); setMoment(null);
    if (wanted) setLane(isGoldWork(wanted) ? 'gold' : null);
    setRunNumber((number) => number + 1); setView('play');
  };
  const started = () => {
    const playing = taskRef.current;
    if (!playing) return;
    setRun(playing); setResult(null);
    coach.selectTask(playing);
  };
  const finish = (raw) => {
    if (!live.current) return;
    const played = taskRef.current;
    raw = { ...raw, assessmentId: raw.assessmentId ?? freshId() };
    const message = coachFeedback(raw, played);
    const passed = message.reason === 'silver' || message.reason === 'passed';
    logger.info('piano.learn.coach.take', { scoreId: score.id, passageId: segment.id, skill: played.skill, depth: played.depth ?? 0, reason: message.reason, passed });
    setLane(isGoldWork(played) ? 'gold' : null);
    coach.record(played, raw);
    if (passed) { setMoment({ id: raw.assessmentId, task: played, raw, was: { silver: Boolean(certification.silver), gold: Boolean(certification.gold) } }); setResult(null); }
    else setResult({ task: played, raw, message });
  };

  // What the pass amounts to, read from the projection the take has just changed.
  const celebrated = moment ? (!moment.was.gold && certification.gold ? 'gold' : !moment.was.silver && certification.silver ? 'silver' : null) : null;
  const followingId = coach.projection.recommended?.passageId;
  const nextPassage = followingId && followingId !== segment.id ? coach.projection.segments.find((item) => item.id === followingId) : null;
  const nextGoldId = piece.nextGoldPassageId;
  const nextGold = nextGoldId && nextGoldId !== segment.id ? coach.projection.segments.find((item) => item.id === nextGoldId) : null;
  const pieceDone = celebrated && piece.total > 0 && piece[celebrated] >= piece.total;
  const leaveFor = celebrated === 'silver' ? (pieceDone ? null : nextPassage) : celebrated === 'gold' ? (pieceDone ? null : nextGold) : null;
  // A pass that does not certify moves straight on, the way a drill's next rep
  // arrives under its card. A Silver or Gold stays on the finished take.
  useEffect(() => {
    if (!moment || celebrated || moment.advanced) return;
    setMoment({ ...moment, advanced: true });
    // A chosen step stays chosen until its set is clear, so its next rep follows.
    const played = moment.task;
    const cleared = (played.depth ?? 0) > 0 || projected?.skills.find((skill) => skill.key === played.key)?.ready === true;
    setSelected(cleared ? null : played); setRun(null); setRunNumber((number) => number + 1);
  }, [moment, celebrated, projected]);
  const momentDone = () => {
    if (!live.current) return;
    const finished = celebrated;
    setMoment(null);
    if (!finished) return;
    logger.info('piano.learn.coach.certified', { scoreId: score.id, passageId: segment.id, level: finished, piece: Boolean(pieceDone), next: leaveFor?.id ?? null });
    if (leaveFor && onPassageChange) onPassageChange(leaveFor.id);
    else onBack?.();
  };
  const card = useMemo(() => {
    if (!moment) return null;
    const { task: played, raw, id } = moment;
    if (celebrated) return { id, icon: <PassageTurn from={celebrated === 'gold' ? 'silver' : 'todo'} to={celebrated} />,
      copy: { eyebrow: barsOf(segment), headline: celebrated === 'gold' ? 'Gold!' : 'Silver!',
        line: pieceDone ? `Your whole piece is ${celebrated === 'gold' ? 'Gold' : 'Silver'}!` : leaveFor ? `Next: ${lower(barsOf(leaveFor))}` : '' } };
    const steps = drill.projection.steps;
    const index = steps.findIndex((step) => step.id === rootOf(played).key);
    const step = (played.depth ?? 0) === 0 ? steps[index] : null;
    const upNext = task && task.key !== played.key ? task : null;
    if (!step) return { id, score: raw.score ?? null,
      copy: { eyebrow: barsOf(segment), headline: Number.isFinite(raw.score) ? `${Math.round(raw.score * 100)}%` : 'Passed', line: upNext ? `Next: ${setName(rootOf(upNext))}` : 'Again' } };
    const repCount = step.requirement.required_passes;
    return { id, score: raw.score ?? null, setIndex: index + 1, setCount: steps.length, repIndex: Math.max(1, step.pass_count), repCount,
      setClear: step.passed, next: { key: step.passed && upNext ? setName(rootOf(upNext)) : step.display.key, hand: null } };
  }, [moment, celebrated, pieceDone, leaveFor, segment, drill, task]);

  // After a miss the drill's own result panel offers the smaller practice and the way out.
  const recovery = result && next && next.depth > 0 && next.key !== result.task.key ? next : null;
  const recoveryAction = !recovery ? null : recovery.reason === 'slower-beat' ? `Try a little slower · ${recovery.tempoPercent}%`
    : recovery.reason === 'one-hand' ? `Practice the ${recovery.parts[0] === 'lh' ? 'left' : 'right'} hand`
      : recovery.range.start === recovery.range.end ? `Practice bar ${recovery.range.start + 1}`
        : `Practice bars ${recovery.range.start + 1}–${recovery.range.end + 1}`;
  const canSetAside = coach.projection.canSetAside?.[segment.id] === true;
  const comeBackLater = () => {
    const target = coach.projection.afterSetAside?.[segment.id];
    logger.info('piano.learn.coach.set-aside', { scoreId: score.id, passageId: segment.id, next: target ?? null });
    coach.setAside(silverTask ?? task);
    if (target && onPassageChange) onPassageChange(target); else onBack?.();
  };
  const laterButton = canSetAside ? <button type="button" onClick={comeBackLater}>Come back to this later</button> : null;
  const resultActions = result ? <>
    {recovery && <button type="button" className="is-primary" onClick={() => begin(recovery)}>{recoveryAction}</button>}
    <button type="button" className={recovery ? '' : 'is-primary'} onClick={() => begin(result.task)}>Try again</button>
    {laterButton}
  </> : null;

  const pickStep = useCallback((step) => {
    const wanted = projected?.skills.find((skill) => skill.key === step.id);
    if (!wanted || wanted.key === taskRef.current?.key) return;
    logger.info('piano.learn.coach.pick', { scoreId: score.id, passageId: segment.id, skill: wanted.skill });
    setSelected(wanted); setRun(null); setResult(null); setMoment(null); setLane(isGoldWork(wanted) ? 'gold' : null);
    setRunNumber((number) => number + 1);
  }, [projected, logger, score.id, segment.id]);

  // Save state is shown only when it needs a hand.
  const retrySave = async () => {
    await coach.retry().catch(() => {});
    const again = result ?? moment;
    if (again && live.current) coach.record(again.task, again.raw);
  };
  const exportEarlier = () => {
    const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([coach.recoveryData()], { type: 'application/json' }));
    link.href = url; link.download = 'piano-earlier-practice.json'; link.click(); URL.revokeObjectURL(url);
  };
  const notice = coach.saveStatus === 'error' || coach.recoveryError ? <div className="piano-learn-coach__save" role="status">
    {coach.saveStatus === 'error' && <><strong>Progress not saved</strong><button type="button" onClick={retrySave}>Retry saving</button></>}
    {coach.recoveryError && <button type="button" aria-label={coach.recoveryError} onClick={exportEarlier}>Export earlier practice</button>}
  </div> : null;

  // The same rail and board as the score view: every passage of the piece, this one outlined.
  const rail = useMemo(() => railModel({ segments: coach.projection.segments, projection: coach.projection, selectedId: segment.id }),
    [coach.projection, segment.id]);
  const gemOffered = usePieceGemOffer({ userId: coach.profileId, enabled: Boolean(board) });
  const goToPassage = (passageId, source) => {
    setBoard(null);
    if (passageId === segment.id) return;
    logger.info('piano.learn.rail.select', { scoreId: score.id, passageId, source });
    onPassageChange?.(passageId);
  };
  const toggleBoard = (focusId) => {
    const open = board && focusId == null ? null : { focusId: focusId ?? null };
    logger.info(open ? 'piano.learn.board.open' : 'piano.learn.board.close', { scoreId: score.id, ...(open ? { passageId: open.focusId } : { by: 'count' }) });
    setBoard(open);
  };
  const flips = celebrated ? { [segment.id]: celebrated } : EMPTY;
  const map = <>
    {board && <PassageBoard title={title ?? barsOf(segment)} model={rail} focusId={board.focusId ?? segment.id} gemOffered={gemOffered}
      review={Boolean(coach.projection.review)}
      onReview={() => { const review = coach.projection.review; coach.selectTask(review); setBoard(null);
        if (review.passageId === segment.id) begin(review); else onPassageChange?.(review.passageId); }}
      onSelect={(passageId) => goToPassage(passageId, 'learn-board')}
      onClose={() => { logger.info('piano.learn.board.close', { scoreId: score.id, by: 'close' }); setBoard(null); }} />}
    <PassageRail model={rail} flips={flips} boardOpen={Boolean(board)} onSelect={(passageId) => goToPassage(passageId, 'learn-rail')} onOpenBoard={toggleBoard} />
  </>;

  if (!task) return <section className="piano-learn-coach"><h2>No playable notes in this passage</h2><button type="button" onClick={onBack}>Back to score</button>{map}</section>;
  if (view === 'listen') return <section className="piano-learn-coach" aria-label={`${barsOf(segment)} demonstration`}>
    <LearnListen score={score} task={task} tempoMap={plan.tempoMap} passageName={barsOf(segment)} onDone={() => { setRunNumber((number) => number + 1); setView('play'); }} />
    {map}
  </section>;
  if (view === 'custom') return <div className="piano-learn-coach">
    <LearnLaunchpad segment={segment} initialView="custom" customOnly initialChoice={choice} onChoiceChange={setChoice}
      preview={<div className="piano-learn-coach__paper piano-exercise-run__score"><ScorePassage key={task.key} musicXml={score.musicXml} sourceId={score.id} rangeIndices={task.range} activeParts={task.parts} keepWholePassage /></div>}
      onBack={() => setView('play')} onLaunch={(launch) => {
        begin(makeCoachTask(plan, { passageId: segment.id, skill: 'custom', label: 'Your practice',
          range: { start: segment.inMeasure, end: segment.outMeasure }, parts: launch.parts, mode: launch.mode,
          tempoPercent: launch.tempoPercent, criteria: { ...plan.criteria, ...launch.rung.criteria }, source: 'custom' }));
      }} />
  </div>;
  return <div className="piano-learn-coach piano-learn-coach--running" data-save={coach.saveStatus} data-level={certification.gold ? 'gold' : certification.silver ? 'silver' : undefined}>
    {loaded && material ? <LearnLab key={`${runNumber}:${task.key}`} score={score} revision={plan.fingerprint} segment={material.segment} rung={material.rung}
      coachingTask={task} drill={drill} card={card} onCardDone={momentDone} notice={notice}
      resultLabel={result?.message.title ?? null} resultActions={resultActions}
      extraControls={result ? null : laterButton}
      onPickStep={pickStep} onStarted={started} onOutcome={finish}
      onListen={() => { onListen?.(task); setView('listen'); }}
      tempo={{ ...tempo, tempoMap: plan.tempoMap, adjustable: false }} feedback={feedback}
      onClose={onBack} onChangePractice={() => setView('custom')}
      onUnavailable={(reason) => logger.warn('piano.learn.coach.unavailable', { scoreId: score.id, passageId: segment.id, skill: task.skill, reason: String(reason) })} />
      : <div className="piano-learn-coach__loading" role="status" aria-label="Loading your practice" />}
    {map}
  </div>;
}
