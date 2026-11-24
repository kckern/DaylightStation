import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { coachFeedback, coachTaskKey, entryShiftBeats, isGoldWork, passageProgress } from '../../../../../../../shared/music/learnCoach.mjs';
import { currentStep, passageAccess, resolveSkipMode } from '../../../../../../../shared/music/learnSkipping.mjs';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { roundScore } from '../../../performance/timedVerdicts.js';
import useLearnCoach from './useLearnCoach.js';
import usePieceGemOffer from './usePieceGemOffer.js';
import LearnLab from './LearnLab.jsx';
import { tempoTrackStops } from './tempoStages.js';
import PassagePath from './PassagePath.jsx';
import PassageBoard from './PassageBoard.jsx';
import PassageCoin, { PassageTurn } from './PassageCoin.jsx';
import { playPassageChime } from './passageChime.js';
import GateCeremony, { hostVerdictAt as verdictAt } from '../Games/GateCeremony.jsx';
import Icon from '../../../ui/icons/Icon.jsx';
import { railModel, unitNames } from './passageRail.js';
import { useKeyboardOnly, useKeyStrip } from './office/KeyboardOnlyContext.js';
import './LearnCoach.scss';

const EMPTY = {};
/** What a step is called under its pills: a set label, not a sentence. */
const SET_NAMES = Object.freeze({ right: 'Right hand', left: 'Left hand', together: 'Together', notes: 'Notes', silver: 'On your own',
  rhythm: 'Rhythm', pulse: 'Beat', mastery: '100%' });
// A timed step's speed is the plan's (`timed-<percent>`, `timed-<percent>-rh|lh`), never a fixed list: the ladder
// is configured (`sheetmusic.learn.goldTempos`) and lifted to a bpm floor.
const TIMED = /^timed-(\d+)(?:-(rh|lh))?$/;
const setName = (task) => {
  if (SET_NAMES[task.skill]) return SET_NAMES[task.skill];
  const timed = TIMED.exec(task.skill ?? '');
  if (timed) return `${timed[2] === 'rh' ? 'Right ' : timed[2] === 'lh' ? 'Left ' : ''}${timed[1]}%`;
  return task.label;
};
/**
 * What stands over a set's pills. A picture where one says it, so the row reads
 * without words: the hands, then the coin they earn; each timed step the metronome
 * with its speed (one hand at the first speed shows that hand), then the gold coin.
 * A step with no picture keeps its words.
 */
const SET_ICONS = Object.freeze({
  // Both hands are always drawn, in their places; the one that rests is unlit.
  right: <><Icon name="hand-left" className="is-resting" /><Icon name="hand-right" /></>, left: <><Icon name="hand-left" /><Icon name="hand-right" className="is-resting" /></>,
  together: <><Icon name="hand-left" /><Icon name="hand-right" /></>, notes: <Icon name="quarter-note" />,
  silver: <PassageCoin state="silver" />, pulse: <Icon name="metronome" />, mastery: <PassageCoin state="gold" />,
});
const iconOf = (skill) => {
  if (SET_ICONS[skill]) return SET_ICONS[skill];
  const timed = TIMED.exec(skill ?? '');
  if (!timed) return null;
  const [, percent, hand] = timed;
  if (hand === 'rh') return <><Icon name="hand-left" className="is-resting" /><Icon name="hand-right" /><b>{percent}%</b></>;
  if (hand === 'lh') return <><Icon name="hand-left" /><Icon name="hand-right" className="is-resting" /><b>{percent}%</b></>;
  return <><Icon name="metronome" /><b>{percent}%</b></>;
};
/** A passage's coin holds the curtain for about two seconds; a finished piece, for more than three. */
export const PASSAGE_CEREMONY_MS = 5000;
export const PIECE_CEREMONY_MS = 7600;
/** Every passage of a finished piece on the curtain, sized so any piece fits in the stage. */
const pieceMarkSize = (count) => (count <= 8 ? '6rem' : count <= 12 ? '4.6rem' : count <= 24 ? '4rem' : count <= 48 ? '3rem' : '2rem');
// A join has no label of its own: it is named by the bars it spans.
const barsOf = (passage) => passage?.barLabel ?? passage?.label ?? (Number.isInteger(passage?.inMeasure) ? `Bars ${passage.inMeasure + 1}–${passage.outMeasure + 1}` : '');
const lower = (label) => label.charAt(0).toLowerCase() + label.slice(1);
/** A recovery step's button label and onward-line sentence, from one place. A
 * slower step without a known tempo says so without a number. */
// eslint-disable-next-line react-refresh/only-export-components -- pure wording is exported for focused contract tests
export function recoveryWording(recovery, names = EMPTY) {
  // A step down to the half of a join the misses sat in, named as the path names it ("Play C–D").
  if (recovery.reason === 'smaller-join') {
    const name = names[recovery.stepDown];
    return name ? { button: `Play ${name}`, sentence: `play ${name}` }
      : { button: `Play bars ${recovery.range.start + 1}–${recovery.range.end + 1}`, sentence: `play bars ${recovery.range.start + 1}–${recovery.range.end + 1}` };
  }
  if (recovery.reason === 'slower-beat') {
    const percent = Number(recovery.tempoPercent);
    return Number.isFinite(percent) && recovery.tempoPercent != null
      ? { button: `Try a little slower · ${percent}%`, sentence: `try a little slower (${percent}%)` }
      : { button: 'Try a little slower', sentence: 'try a little slower' };
  }
  if (recovery.reason === 'rhythm') return { button: 'Tap the rhythm', sentence: 'tap the rhythm' };
  const button = recovery.reason === 'one-hand' ? `Practice the ${recovery.parts?.[0] === 'lh' ? 'left' : 'right'} hand`
    : recovery.range.start === recovery.range.end ? `Practice bar ${recovery.range.start + 1}`
      : `Practice bars ${recovery.range.start + 1}–${recovery.range.end + 1}`;
  return { button, sentence: lower(button) };
}
/** The plan step a task belongs to: itself, or the step a recovery drill came from. */
const rootOf = (task) => { let at = task; while (at?.parent) at = at.parent; return at; };
/** What a drill's pass card says comes next: a smaller or growing drill by its bars, otherwise its step. */
const nextName = (task, segment) => {
  if (!(task.depth > 0) || task.reason === 'one-hand' || task.reason === 'slower-beat') return setName(rootOf(task));
  if (task.range.start === segment.inMeasure && task.range.end === segment.outMeasure) return setName(rootOf(task));
  return task.range.start === task.range.end ? `Bar ${task.range.start + 1}` : `Bars ${task.range.start + 1}–${task.range.end + 1}`;
};
const freshId = () => `coach-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/**
 * Whether a pass of `task` played at `percent` (a tempo the child chose above the step's) would fill
 * `skill`: the coach's test-out (shared/music/learnCoach.mjs `testedOutBy`) drawn on the strip before
 * the take, so the child sees what going faster is worth.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure rule is exported for focused contract tests
export function passFills(task, skill, percent) {
  if (!task || skill.track !== 'gold' || skill.passageId !== task.passageId || skill.assist === 'none') return false;
  if (skill.range?.start !== task.range?.start || skill.range?.end !== task.range?.end || !skill.parts.every((part) => task.parts.includes(part))) return false;
  if (task.rhythm && !skill.rhythm) return false;
  if (skill.rhythm) return true;
  if (task.mode === 'metronome' && skill.mode !== 'metronome') return false;
  if (skill.mode === 'metronome') return true;
  return skill.mode === 'cued' && skill.tempoPercent <= percent;
}

/**
 * The tempo track a coached step offers (LearnLab `tempoChoice`): its stops from the plan's own Gold
 * rung tempos for this unit, never a list of numbers here; the step's tempo is the floor, except on the
 * rhythm step, a warm-up that must never wall a child, which goes down to the lowest timed rung. Rungs
 * already earned are filled.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure projection is exported for focused contract tests
export function coachTempoTrack(passage, task) {
  if (!task || !['cued', 'metronome'].includes(task.mode) || !Number.isFinite(task.tempoPercent)) return null;
  const gold = (passage?.skills ?? []).filter((skill) => skill.track === 'gold' && skill.mode === 'cued' && Number.isFinite(skill.tempoPercent));
  const timed = gold.filter((skill) => !skill.rhythm);
  const ladder = [...new Set(timed.map((skill) => skill.tempoPercent))].sort((a, b) => a - b);
  const floor = task.rhythm ? Math.min(task.tempoPercent, ladder[0] ?? task.tempoPercent) : task.tempoPercent;
  const same = (skill) => skill.parts.length === task.parts.length && skill.parts.every((part) => task.parts.includes(part));
  const earned = [...new Set((task.rhythm ? gold.filter((skill) => skill.rhythm) : timed.filter(same)).filter((skill) => skill.ready).map((skill) => skill.tempoPercent))];
  return { stops: tempoTrackStops({ ladder, stepPercent: task.tempoPercent, floor }), ladder, earned, stepPercent: task.tempoPercent };
}

/** A step the child cannot start yet: its picture, dimmed, under a small lock. */
const lockedIcon = (icon) => <span className="piano-learn-coach__locked">{icon}<Icon name="lock" className="piano-learn-coach__lock" /></span>;

/**
 * A unit's steps as the drill surface draws a program, ONE LAP AT A TIME (2026-11-23 night): the lap of
 * the step being played (the Bronze/Silver lap: the hands, together, the check; the Gold lap: rhythm,
 * beat, the timed rungs, score tempo). Later-lap steps are not drawn. Every step shown is a set, and the
 * clean takes it needs are its reps. `access` (by step key, from the skipping policy) marks the steps
 * that cannot be started; `showLocks` draws a lock on them, which a `strict` ladder does not need.
 * `unit` ({ letter, state, ring }, the unit's token on the path) heads the strip with the same coin and
 * "<letter> · steps to <level>", so the strip reads as that token's.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure projection is exported for focused contract tests
export function passageDrill(passage, task, { access = EMPTY, showLocks = false, unit = null, preview = null } = {}) {
  const current = rootOf(task)?.key ?? null;
  const lap = rootOf(task)?.track === 'gold' ? 'gold' : 'silver';
  const level = lap === 'gold' ? 'Gold' : passage?.kind === 'join' ? 'Silver' : 'Bronze';
  const steps = (passage?.skills ?? []).filter((skill) => (skill.track === 'gold' ? 'gold' : 'silver') === lap).map((skill) => {
    // A step with no fixed count is earned by two good takes out of the last three.
    const reps = Math.max(1, skill.required ?? 2);
    const banked = skill.ready ? reps : Math.min(reps - 1, skill.successes ?? 0);
    const locked = access[skill.key] === 'locked' && skill.key !== current;
    const icon = iconOf(skill.skill);
    return { id: skill.key, title: locked ? `${skill.label} (locked)` : skill.label,
      display: { key: setName(skill), hand: null, hand_label: null, icon: locked && showLocks ? lockedIcon(icon ?? <b>{setName(skill)}</b>) : icon },
      requirement: { required_passes: reps }, pass_count: banked, passed: Boolean(skill.ready),
      state: skill.ready ? 'complete' : skill.key === current ? 'current' : 'locked', ...(locked ? { locked: true } : {}),
      ...(!skill.ready && preview != null && passFills(task, skill, preview) ? { preview: true } : {}) };
  });
  const name = unit?.letter ?? null;
  // On a step down the strip says what is being practised first, and what it climbs back to.
  const first = unit?.stepDownName ?? null;
  const words = first && name ? { text: `${first} first · then ${name}`, label: `${first} first, then ${name}` }
    : { text: `${name ? `${name} · ` : ''}steps to ${level}`, label: `${name ? `${name}, ` : ''}steps to ${level}` };
  const head = { ...words, lap, level: level.toLowerCase(),
    // On a step down the coin is the half being played.
    mark: first && name ? <PassageCoin state={unit.stepDownState ?? 'joined'} letter={first} size="100%" />
      : name ? <PassageCoin state={unit.state} letter={name} ring={unit.ring} size="100%" /> : null };
  return { projection: { id: `learn:${passage?.id}`, title: barsOf(passage), displaySingleStep: true, steps, head },
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
function CoachSession({ score, title, plan, segment, coach, skipping = null, assist = null, polish = null, tempo = EMPTY, feedback, onBack, onPassageChange, onListen }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-learn-coach' }), []);
  const [selected, setSelected] = useState(null);
  const [lane, setLane] = useState(null); // 'gold' once the child is working on Gold here
  const [run, setRun] = useState(null); // the task of a take that has begun
  const [result, setResult] = useState(null); // the last finished take, until the next one begins
  const [moment, setMoment] = useState(null); // the pass being celebrated
  const [runNumber, setRunNumber] = useState(0);
  const [board, setBoard] = useState(null); // null, or { focusId }
  // A tempo the child chose on the header's track for one step ({ key, percent }); any other step plays at its own.
  const [choice, setChoice] = useState(null);
  // Misses in a row at a chosen tempo, and on the rhythm step, by step key: two of either changes what is offered.
  const [misses, setMisses] = useState({});
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const projected = coach.projection.segments.find((item) => item.id === segment.id);
  // Which steps the child may start: the household's skipping policy for this child and piece.
  const skipMode = resolveSkipMode({ skipping, userId: coach.profileId, scoreId: plan.scoreId, authored: Boolean(projected?.authoredLadder) });
  const access = useMemo(() => passageAccess(projected, skipMode), [projected, skipMode]);
  // A saved resume on a step the mode now locks (chosen under a looser mode) is not resumed.
  const allowed = (wanted) => (wanted && access[rootOf(wanted).key] !== 'locked' ? wanted : null);
  const recommended = allowed(coach.projection.recommended?.passageId === segment.id ? coach.projection.recommended : null);
  const certification = projected?.certification ?? {};
  const goldDrill = allowed(coach.projection.goldResume?.passageId === segment.id ? coach.projection.goldResume : null);
  const goldNext = coach.projection.gold?.[segment.id] ?? null;
  const silverTask = projected?.skills.find((skill) => skill.assist === 'none') ?? null;
  const silverNext = recommended ?? projected?.skills.find((task) => task.track === 'silver' && !task.ready);
  const next = (lane === 'gold' ? goldDrill ?? goldNext : null) ?? silverNext ?? goldDrill ?? goldNext
    ?? projected?.skills.find((task) => !task.ready)
    ?? (coach.projection.review?.passageId === segment.id ? coach.projection.review : null) ?? segment.tasks?.at(-1) ?? null;
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
      // A step down is named as the path names its half ("Play C–D").
      rung: { id: wanted.skill, label: wanted.stepDown && unitNames(plan.segments)[wanted.stepDown] ? `Play ${unitNames(plan.segments)[wanted.stepDown]}` : wanted.label, effectiveParts: wanted.parts, mode: wanted.mode,
        tempoPercent: wanted.tempoPercent, criteria: wanted.criteria, sets: 1, reps: 1, required: 1, passCount: 0 } };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the task's identity, not the projection's fresh objects
  }, [plan, segment.barLabel, segment.inMeasure, segment.outMeasure, task?.key, runNumber]);

  useEffect(() => {
    logger.info('piano.learn.coach.step', { scoreId: score.id, passageId: segment.id, skill: task?.skill ?? null,
      mode: task?.mode ?? null, depth: task?.depth ?? 0 });
  }, [logger, score.id, segment.id, task?.key, task?.skill, task?.mode, task?.depth]);

  const begin = (wanted) => {
    setSelected(wanted ?? null); setRun(null); setResult(null); setMoment(null);
    if (wanted) setLane(isGoldWork(wanted) ? 'gold' : null);
    setRunNumber((number) => number + 1);
  };
  const started = () => {
    const playing = taskRef.current;
    if (!playing) return;
    setRun(playing); setResult(null);
    coach.selectTask(playing);
  };
  const finish = (raw, { placementShare = null, tempoPercent: playedTempo = null } = {}) => {
    if (!live.current) return;
    const step = taskRef.current;
    // A take at a tempo the child chose is recorded at that tempo, with the step's own beside it: a pass
    // tests out the unit's Gold steps up to it, a miss changes nothing (learnCoach.mjs `chosenTempo`).
    const chosen = step.mode !== 'free' && Number.isFinite(playedTempo) && playedTempo !== step.tempoPercent;
    const played = chosen ? (({ key: _old, ...rest }) => { const task = { ...rest, tempoPercent: playedTempo, stepTempoPercent: step.tempoPercent };
      return { ...task, key: coachTaskKey(task) }; })(step) : step;
    raw = { ...raw, assessmentId: raw.assessmentId ?? freshId() };
    const message = coachFeedback(raw, played);
    const passed = message.reason === 'silver' || message.reason === 'passed';
    logger.info('piano.learn.coach.take', { scoreId: score.id, passageId: segment.id, skill: played.skill, depth: played.depth ?? 0, reason: message.reason, passed,
      // The scores the take was judged on, so a timing failure can be read from the log alone.
      tempoPercent: played.tempoPercent ?? 100,
      // The wider full-credit share a below-score-tempo take is judged with
      // (LearnLab `learnPracticeRequirement`), or null for the strict curve.
      placementShare,
      placement: roundScore(raw.criteria?.placement), completeness: roundScore(raw.criteria?.completeness), cleanliness: roundScore(raw.criteria?.cleanliness),
      // A whole-beat shifted entry the run tested for: ±k, 0 none named, null not tested.
      entryShiftBeats: entryShiftBeats(raw) });
    setLane(isGoldWork(played) ? 'gold' : null);
    coach.record(played, raw);
    // Two misses in a row at a chosen tempo go back to the step's own; two on the rhythm step offer the skip.
    const missed = (misses[step.key] ?? 0) + 1;
    setMisses((counts) => ({ ...counts, [step.key]: passed ? 0 : missed }));
    const backTo = chosen && !passed && missed >= 2 && playedTempo > step.tempoPercent ? step.tempoPercent : null;
    if (backTo != null) { setChoice(null); setMisses((counts) => ({ ...counts, [step.key]: 0 }));
      logger.info('piano.learn.tempo.snap-back', { scoreId: score.id, passageId: segment.id, skill: step.skill, from: playedTempo, to: backTo }); }
    if (passed) setChoice(null);
    if (passed) { setMoment({ id: raw.assessmentId, task: played, step, raw, was: { silver: Boolean(certification.silver), gold: Boolean(certification.gold), flower: Boolean(projected?.flower) } }); setResult(null); }
    else setResult({ task: step, played, raw, message: backTo != null ? { ...message, title: `Back to ${backTo}%` } : message, missed });
  };

  // What the pass amounts to, read from the projection the take has just changed.
  const celebrated = moment ? (!moment.was.gold && certification.gold ? 'gold' : !moment.was.silver && certification.silver ? 'silver' : null) : null;
  const followingId = coach.projection.recommended?.passageId;
  const nextPassage = followingId && followingId !== segment.id ? coach.projection.segments.find((item) => item.id === followingId) : null;
  const nextGoldId = piece.nextGoldPassageId;
  const nextGold = nextGoldId && nextGoldId !== segment.id ? coach.projection.segments.find((item) => item.id === nextGoldId) : null;
  // A passage's first certificate is Bronze; a join's is Silver, and the final join (or the one passage of a
  // one-passage piece) is the piece played through. Gold is still every passage.
  const isJoin = segment.kind === 'join';
  const coinOf = (level) => (level === 'silver' && isJoin ? 'joined' : level);
  const pieceDone = celebrated === 'gold' ? piece.polishReady === true
    : celebrated === 'silver' && piece.pieceSilver === true && (isJoin ? segment.final === true : piece.total === 1);
  // After a Gold won off the lap (before the piece is played through) the child goes on to the coach's next unit.
  const leaveFor = celebrated === 'silver' ? (pieceDone ? null : nextPassage) : celebrated === 'gold' ? (pieceDone ? null : nextGold ?? nextPassage) : null;
  // A pass that does not certify moves straight on, the way a drill's next rep
  // arrives under its card. A Silver or Gold stays on the finished take.
  useEffect(() => {
    if (!moment || celebrated || moment.advanced) return;
    setMoment({ ...moment, advanced: true });
    // A chosen step stays chosen until its set is clear, so its next rep follows.
    const played = moment.step ?? moment.task;
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
  // The same path and board as the score view: every passage of the piece, this unit selected. While a
  // join's Silver lands, the path keeps the Silver drawing so the coin turns where the child earned it.
  const holdLap = celebrated === 'silver' && isJoin ? 'silver' : null;
  // A step down (a join missed twice in one half): the half being practised, from the task or a drill under it.
  const stepDown = (() => { for (let at = task; at; at = at.parent) if (at.stepDown) return at.stepDown; return null; })();
  const rail = useMemo(() => railModel({ segments: coach.projection.segments, projection: coach.projection, selectedId: segment.id, polish, lap: holdLap, stepDown }),
    [coach.projection, segment.id, polish, holdLap, stepDown]);
  // The strip is headed by this unit's own token: the same lettered coin, the same ring.
  const unitToken = rail.cards.find((card) => card.id === segment.id) ?? null;
  const unitLetter = unitToken?.letter ?? rail.names?.[segment.id] ?? null; const unitState = unitToken?.state ?? null; const unitRing = unitToken?.ring;
  const stepDownName = stepDown ? rail.names?.[stepDown] ?? null : null;
  const stepDownState = stepDown ? rail.cards.find((card) => card.id === stepDown)?.state ?? 'joined' : null;
  const chosenPercent = choice && task && choice.key === task.key ? choice.percent : null;
  const drill = useMemo(() => passageDrill(projected, task, { access, showLocks: skipMode !== 'strict',
    unit: unitLetter ? { letter: unitLetter, state: unitState ?? 'joined', ring: unitRing, stepDownName, stepDownState } : null,
    preview: chosenPercent != null && chosenPercent > task?.tempoPercent ? chosenPercent : null }),
  [projected, task, access, skipMode, unitLetter, unitState, unitRing, stepDownName, stepDownState, chosenPercent]);
  const track = useMemo(() => coachTempoTrack(projected, task), [projected, task]);
  const tempoChoice = track ? { ...track, value: chosenPercent ?? task.tempoPercent,
    onChange: (percent) => { logger.info('piano.learn.tempo.choose', { scoreId: score.id, passageId: segment.id, skill: task.skill, from: chosenPercent ?? task.tempoPercent, to: percent, step: task.tempoPercent });
      setChoice(percent === task.tempoPercent ? null : { key: task.key, percent }); } } : null;
  const card = useMemo(() => {
    if (!moment) return null;
    const { task: played, raw, id } = moment;
    if (celebrated) return null;
    // A pass at a chosen tempo says what it earned: everything up to it (a slower rhythm pass, the rhythm).
    if (Number.isFinite(played.stepTempoPercent)) return { id, score: raw.score ?? null,
      copy: { eyebrow: barsOf(segment), headline: `Passed at ${played.tempoPercent}%`,
        line: played.tempoPercent > played.stepTempoPercent ? `Everything up to ${played.tempoPercent}% done` : 'Rhythm done' } };
    const steps = drill.projection.steps;
    const index = steps.findIndex((step) => step.id === rootOf(played).key);
    const step = (played.depth ?? 0) === 0 ? steps[index] : null;
    const upNext = task && task.key !== played.key ? task : null;
    if (!step) return { id, score: raw.score ?? null,
      copy: { eyebrow: barsOf(segment), headline: Number.isFinite(raw.score) ? `${Math.round(raw.score * 100)}%` : 'Passed', line: upNext ? `Next: ${nextName(upNext, segment)}` : 'Again' } };
    const repCount = step.requirement.required_passes;
    return { id, score: raw.score ?? null, setIndex: index + 1, setCount: steps.length, repIndex: Math.max(1, step.pass_count), repCount,
      setClear: step.passed, next: { key: step.passed && upNext ? setName(rootOf(upNext)) : step.display.key, hand: null } };
  }, [moment, celebrated, segment, drill, task]);

  // Silver and Gold are the drill's big moment: its curtain closes on the take,
  // the passage's icon turns into the coin on it, and it parts onto what is next.
  // The take that finishes the piece puts every passage on the curtain.
  const ceremonyMs = pieceDone ? PIECE_CEREMONY_MS : PASSAGE_CEREMONY_MS;
  const celebrating = celebrated ? moment.id : null;
  useEffect(() => {
    if (!celebrating) return undefined;
    const timer = setTimeout(() => {
      const sounded = playPassageChime({ level: celebrated, piece: Boolean(pieceDone) });
      logger.info('piano.learn.celebrate', { scoreId: score.id, scope: pieceDone ? 'piece' : 'passage', level: celebrated, passages: [segment.id], sounded });
    }, verdictAt(ceremonyMs));
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one chime per celebrated take
  }, [celebrating]);
  const ceremony = (() => {
    if (!celebrating) return null;
    const metal = celebrated === 'gold' ? 'Gold' : isJoin ? 'Silver' : 'Bronze';
    const turnDelay = { '--turn-delay': `${verdictAt(ceremonyMs)}ms` };
    if (pieceDone) {
      const passages = coach.projection.segments;
      const columns = Math.ceil(passages.length / Math.ceil(passages.length / 12));
      const stagger = Math.min(45, 900 / passages.length);
      const word = celebrated === 'gold' ? 'All Gold!' : 'Piece Silver!';
      return <GateCeremony key={celebrating} durationMs={ceremonyMs} word={word} announce={celebrated === 'gold' ? 'Your whole piece is Gold!' : 'You played the whole piece!'}
        mark={<span className="piano-learn-coach__piece-mark" style={{ gridTemplateColumns: `repeat(${columns}, auto)`, fontSize: pieceMarkSize(passages.length) }}>
          {passages.filter((item) => item.kind !== 'join').map((item, index) => <span key={item.id} style={{ '--turn-delay': `${Math.round(verdictAt(ceremonyMs) + index * stagger)}ms` }}>
            <PassageTurn from={celebrated === 'gold' ? 'silver' : 'silver'} to={celebrated === 'gold' ? 'gold' : 'joined'} /></span>)}
        </span>}
        behind={celebrated === 'silver' ? { mark: <PassageCoin state="gold" />, eyebrow: 'Next', label: 'Go for Gold' }
          : { mark: <PassageCoin state="gold" />, eyebrow: 'All Gold', label: title ?? barsOf(segment) }}
        onDone={momentDone} />;
    }
    return <GateCeremony key={celebrating} durationMs={ceremonyMs} word={`${metal}!`} announce={`${barsOf(segment)}. ${metal}!${leaveFor ? ` Next: ${lower(barsOf(leaveFor))}.` : ''}`}
      mark={<span style={turnDelay}><PassageTurn from={celebrated === 'gold' ? 'silver' : isJoin ? 'todo' : moment.was.flower ? 'learning' : 'todo'} to={coinOf(celebrated)} /></span>}
      behind={leaveFor ? { mark: <PassageCoin state={leaveFor.kind === 'join' && passageProgress(leaveFor).state === 'silver' ? 'joined' : passageProgress(leaveFor).state} />, eyebrow: 'Next', label: leaveFor.kind === 'join' ? `Play ${lower(barsOf(leaveFor))} together` : barsOf(leaveFor) }
        : { mark: <PassageCoin state={coinOf(celebrated)} />, eyebrow: barsOf(segment), label: metal }}
      onDone={momentDone} />;
  })();

  // After a miss the drill's own result panel offers the smaller practice and the way out.
  const recovery = result && next && next.depth > 0 && next.key !== result.task.key ? next : null;
  // One wording per recovery: the button, and the sentence the onward line
  // finishes ("play any key to try a little slower (75%)").
  const recoveryWords = recovery ? recoveryWording(recovery, rail.names) : null;
  const recoveryAction = recoveryWords?.button ?? null;
  const canSetAside = coach.projection.canSetAside?.[segment.id] === true;
  const comeBackLater = () => {
    const target = coach.projection.afterSetAside?.[segment.id];
    logger.info('piano.learn.coach.set-aside', { scoreId: score.id, passageId: segment.id, next: target ?? null });
    coach.setAside(silverTask ?? task);
    if (target && onPassageChange) onPassageChange(target); else onBack?.();
  };
  const laterButton = canSetAside ? <button type="button" className="piano-learn-lab__action" onClick={comeBackLater}><span>Come back to this later</span></button> : null;
  // The rhythm step never walls a child: it can always be skipped (it earns nothing, and the lap moves on).
  const rhythmStep = task?.rhythm === true && (task.depth ?? 0) === 0;
  const skipRhythm = () => {
    logger.info('piano.learn.rhythm.skip', { userId: coach.profileId, scoreId: score.id, passageId: segment.id, misses: misses[task.key] ?? 0 });
    coach.skipRhythm?.(task);
    setSelected(null); setRun(null); setResult(null); setMoment(null); setChoice(null); setLane('gold'); setRunNumber((number) => number + 1);
  };
  const skipButton = rhythmStep ? <button type="button" className="piano-learn-lab__action is-quiet" onClick={skipRhythm}><Icon name="next" /><span>Skip rhythm</span></button> : null;
  const resultActions = result ? <>
    {recovery && <button type="button" className="is-primary" onClick={() => begin(recovery)}>{recoveryAction}</button>}
    <button type="button" className={recovery ? '' : 'is-primary'} onClick={() => begin(result.task)}>Try again</button>
    {rhythmStep && result.missed >= 2 && <button type="button" onClick={skipRhythm}>Skip rhythm</button>}
    {laterButton}
  </> : null;
  // Any key on the piano takes the primary button, so the help the card
  // recommends (a slower tempo, one hand) never needs a reach to the glass.
  const resultContinue = !result ? null : recovery ? () => begin(recovery) : () => begin(result.task);
  const resultContinueLabel = !result ? null : recovery ? recoveryWords.sentence : 'try again';

  const pickStep = useCallback((step) => {
    const wanted = projected?.skills.find((skill) => skill.key === step.id);
    if (!wanted || wanted.key === taskRef.current?.key || access[wanted.key] === 'locked') return;
    logger.info('piano.learn.coach.pick', { scoreId: score.id, passageId: segment.id, skill: wanted.skill });
    // Starting a step the ladder would not hand over next (a done step played again is no skip).
    const from = currentStep(projected);
    if (from && from.key !== wanted.key && !wanted.ready) {
      logger.info('piano.learn.coach.skip', { userId: coach.profileId, scoreId: score.id, passageId: segment.id, from: from.skill, to: wanted.skill, mode: skipMode });
    }
    setSelected(wanted); setRun(null); setResult(null); setMoment(null); setLane(isGoldWork(wanted) ? 'gold' : null);
    setRunNumber((number) => number + 1);
  }, [projected, access, skipMode, coach.profileId, logger, score.id, segment.id]);

  // Save state is shown only when it needs a hand.
  const retrySave = async () => {
    await coach.retry().catch(() => {});
    const again = result ?? moment;
    if (again && live.current) coach.record(again.played ?? again.task, again.raw);
  };
  const exportEarlier = () => {
    const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([coach.recoveryData()], { type: 'application/json' }));
    link.href = url; link.download = 'piano-earlier-practice.json'; link.click(); URL.revokeObjectURL(url);
  };
  const notice = coach.saveStatus === 'error' || coach.recoveryError ? <div className="piano-learn-coach__save" role="status">
    {coach.saveStatus === 'error' && <><strong>Progress not saved</strong><button type="button" onClick={retrySave}>Retry saving</button></>}
    {coach.recoveryError && <button type="button" aria-label={coach.recoveryError} onClick={exportEarlier}>Export earlier practice</button>}
  </div> : null;

  const gemOffered = usePieceGemOffer({ userId: coach.profileId, enabled: Boolean(board) });
  const goToPassage = (passageId, source) => {
    setBoard(null);
    if (passageId === segment.id) return;
    logger.info('piano.learn.rail.select', { scoreId: score.id, passageId, source });
    onPassageChange?.(passageId);
  };
  // On the drill screen every token opens its unit: there is no score here to show its bars on.
  const openFromPath = (passageId) => {
    if (passageId !== segment.id) logger.info('piano.learn.path.open', { scoreId: score.id, passageId, from: segment.id });
    goToPassage(passageId, 'learn-rail');
  };
  const toggleBoard = (focusId) => {
    const open = board && focusId == null ? null : { focusId: focusId ?? null };
    logger.info(open ? 'piano.learn.board.open' : 'piano.learn.board.close', { scoreId: score.id, ...(open ? { passageId: open.focusId } : { by: 'all' }) });
    setBoard(open);
  };
  // The path answers the curtain: this unit's token turns as the verdict
  // lands, and a finished piece turns every token in a wave.
  const flips = useMemo(() => (!celebrated ? EMPTY : pieceDone && celebrated === 'gold' ? Object.fromEntries(coach.projection.segments.map((item) => [item.id, celebrated])) : { [segment.id]: celebrated }),
    [celebrated, pieceDone, coach.projection.segments, segment.id]);
  const map = <>
    {board && <PassageBoard title={title ?? barsOf(segment)} model={rail} focusId={board.focusId ?? segment.id} gemOffered={gemOffered} polish={polish}
      review={Boolean(coach.projection.review)}
      onReview={() => { const review = coach.projection.review; coach.selectTask(review); setBoard(null);
        if (review.passageId === segment.id) begin(review); else onPassageChange?.(review.passageId); }}
      onSelect={(passageId) => goToPassage(passageId, 'learn-board')}
      onClose={() => { logger.info('piano.learn.board.close', { scoreId: score.id, by: 'close' }); setBoard(null); }} />}
    <PassagePath model={rail} flips={flips} flipDelayMs={verdictAt(ceremonyMs)} wave={Boolean(pieceDone)} boardOpen={Boolean(board)}
      onSelect={(passageId) => goToPassage(passageId, 'learn-rail')} onOpen={openFromPath} onOpenBoard={toggleBoard} />
  </>;

  // ── Keyboard only (the office screen) ──────────────────────────────────────
  // Every button above is touch; there, each becomes a key on the host's strip.
  // The tempo track and the click volume keep their defaults, and the step pills
  // are read, not picked: a choice a hand cannot make is not drawn as one.
  const keyOnly = useKeyboardOnly();
  const unitOrder = rail.tokens?.length ? rail.tokens.map((token) => token.id) : coach.projection.segments.map((item) => item.id);
  const unitAt = unitOrder.indexOf(segment.id);
  const previousUnit = unitAt > 0 ? unitOrder[unitAt - 1] : null;
  const nextUnit = unitAt >= 0 && unitAt < unitOrder.length - 1 ? unitOrder[unitAt + 1] : null;
  const busy = Boolean(celebrating);
  useKeyStrip('coach', {
    previous: previousUnit && !busy ? { onSelect: () => goToPassage(previousUnit, 'office-strip') } : null,
    next: nextUnit && !busy ? { onSelect: () => goToPassage(nextUnit, 'office-strip') } : null,
    retry: result && !busy ? { onSelect: () => begin(result.task) } : null,
    later: busy ? null : rhythmStep ? { label: 'Skip rhythm', onSelect: skipRhythm } : canSetAside ? { label: 'Come back later', onSelect: comeBackLater } : null,
  });

  if (!task) return <section className="piano-learn-coach"><h2>No playable notes in this passage</h2>{!keyOnly && <button type="button" onClick={onBack}>Back to score</button>}{map}</section>;
  return <div className="piano-learn-coach piano-learn-coach--running" data-save={coach.saveStatus} data-level={certification.gold ? 'gold' : certification.silver ? 'silver' : undefined} data-input={keyOnly ? 'keyboard-only' : undefined}>
    {loaded && material ? <LearnLab key={`${runNumber}:${task.key}`} score={score} revision={plan.fingerprint} segment={material.segment} rung={material.rung}
      coachingTask={task} assist={assist} drill={drill} card={card} ceremony={ceremony} onCardDone={momentDone} notice={notice}
      resultLabel={result?.message.title ?? null} resultActions={keyOnly ? null : resultActions} resultContinueLabel={resultContinueLabel} onResultContinue={resultContinue}
      extraControls={keyOnly ? null : result ? skipButton : <>{skipButton}{laterButton}</>} tempoChoice={keyOnly ? null : tempoChoice}
      onPickStep={keyOnly ? null : pickStep} onStarted={started} onOutcome={finish}
      onListen={() => onListen?.(task)}
      tempo={{ ...tempo, tempoMap: plan.tempoMap, adjustable: false }} feedback={feedback}
      onClose={onBack}
      onUnavailable={(reason) => logger.warn('piano.learn.coach.unavailable', { scoreId: score.id, passageId: segment.id, skill: task.skill, reason: String(reason) })} />
      : <div className="piano-learn-coach__loading" role="status" aria-label="Loading your practice" />}
    {map}
  </div>;
}
