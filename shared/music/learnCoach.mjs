/** Versioned, deterministic teaching policy. No clocks, IO, MIDI or React. */
export const COACH_VERSION = 1;
const PITCH = Object.freeze({ completeness: 1, cleanliness: 0.8 });
const TIMED = Object.freeze({ ...PITCH, placement: 0.8 });
export const CERTIFICATION_DEFAULTS = Object.freeze({
  silver: Object.freeze({ stepPasses: 1, checkPasses: 1, cleanliness: 0.8, stallSeconds: 30 }),
  // When an uncertified passage counts as partway: `both-hands` (each hand alone, or the
  // hands together), `together` (the hands together only) or `first-step` (any note step).
  flower: Object.freeze({ after: 'both-hands' }),
});
export const FLOWER_AFTER = Object.freeze(['both-hands', 'together', 'first-step']);
const LEGACY_STEP_PASSES = 6;
/** The cued Gold steps below score tempo. The ladder was 60/80 until 2026-11; earned keys at other tempos carry over. */
const GOLD_TEMPOS = Object.freeze([50, 60, 75]);
/** Where a timing-only miss steps down to, one rung at a time. */
const SLOWER_TEMPOS = Object.freeze([40, ...GOLD_TEMPOS, 100]);
/** Ladder shape a saved state was written under: 2 = each hand with the beat at 50% (2026-11-22). */
const LADDER_REVISION = 2;
const ONE_HAND_BEAT = /^timed-\d+-(rh|lh)$/;
const MAX_POLICY_PASSES = 20;
/**
 * How far a missed step can shrink: the way into the hard bar, the hard bar
 * alone, then one hand of it. Was 2 until 2026-11, which stopped one short of
 * the hand a learner was missing.
 */
const MAX_DRILL_DEPTH = 3;
const wholeIn = (value, fallback) => (Number.isInteger(value) && value >= 1 && value <= MAX_POLICY_PASSES ? value : fallback);

/** YAML-defined certification policy, with every invalid value replaced by its default. */
export function normalizeCertification(raw) {
  const silver = raw?.silver ?? {};
  const fallback = CERTIFICATION_DEFAULTS.silver;
  return { silver: {
    stepPasses: wholeIn(silver.stepPasses, fallback.stepPasses),
    checkPasses: wholeIn(silver.checkPasses, fallback.checkPasses),
    cleanliness: Number.isFinite(silver.cleanliness) && silver.cleanliness > 0 && silver.cleanliness <= 1 ? silver.cleanliness : fallback.cleanliness,
    stallSeconds: Number.isFinite(silver.stallSeconds) && silver.stallSeconds >= 5 && silver.stallSeconds <= 600 ? silver.stallSeconds : fallback.stallSeconds,
  }, flower: { after: FLOWER_AFTER.includes(raw?.flower?.after) ? raw.flower.after : CERTIFICATION_DEFAULTS.flower.after } };
}

const partsOf = (parts = []) => [...new Set(parts)].sort((a, b) => {
  const order = (part) => part === 'rh' ? 0 : part === 'lh' ? 1 : 2;
  return order(a) - order(b) || a.localeCompare(b);
});
const fingerprintOf = (value) => typeof value === 'string' ? value : value?.contentSha256;
const sameParts = (a, b) => JSON.stringify(partsOf(a)) === JSON.stringify(partsOf(b));
const sameRange = (a, b) => a?.start === b?.start && a?.end === b?.end;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;

export function coachTaskKey(task) {
  // The Silver check is identified without its criteria, so a policy change keeps earned Silver.
  if (task.assist === 'none') return JSON.stringify(['silver-check', task.scoreId, task.fingerprint, task.range.start, task.range.end, partsOf(task.parts)]);
  return JSON.stringify([task.scoreId, task.fingerprint, task.range.start, task.range.end,
    partsOf(task.parts), task.mode, task.mode === 'free' ? null : task.tempoPercent, canonical(task.criteria),
    ...(task.authoredStage != null ? [[task.authoredSeries, task.authoredStage]] : [])]);
}

export function makeCoachTask(plan, spec) {
  const task = {
    scoreId: plan.scoreId, fingerprint: plan.fingerprint, passageId: spec.passageId,
    skill: spec.skill, label: spec.label, parts: partsOf(spec.parts),
    range: { ...spec.range }, mode: spec.mode ?? 'free', tempoPercent: spec.mode === 'free' ? null : spec.tempoPercent ?? 60,
    criteria: { ...(spec.mode === 'cued' ? TIMED : PITCH), ...spec.criteria },
    required: spec.required ?? null, consecutive: spec.consecutive === true,
    completes: spec.completes === true, mastery: spec.mastery === true,
    ...(spec.authoredStage != null ? { authoredSeries: spec.authoredSeries, authoredStage: spec.authoredStage, legacySkill: spec.legacySkill, legacyRequired: spec.legacyRequired } : {}),
    depth: spec.depth ?? 0, ...(spec.parent ? { parent: spec.parent } : {}),
    ...(spec.track ? { track: spec.track } : {}), ...(spec.assist ? { assist: spec.assist } : {}),
    ...(spec.stallSeconds ? { stallSeconds: spec.stallSeconds } : {}),
    ...(spec.authoredStage == null && spec.legacyRequired != null ? { legacyRequired: spec.legacyRequired } : {}),
    ...(spec.review ? { review: true } : {}), ...(spec.source ? { source: spec.source } : {}),
    ...(spec.reason ? { reason: spec.reason } : {}),
  };
  return { ...task, key: coachTaskKey(task) };
}


/**
 * The merge tree of joins over a piece's passages, in order: adjacent pairs, then
 * pairs of pairs; an odd unit out carries up to the next level. Returned in
 * post-order (a join comes after everything under it); the top join is `final`.
 * A piece of one passage has none. Pure: reads only each passage's id and bars.
 */
export function buildJoinTree(passages = []) {
  let level = passages.map((passage) => ({ id: passage.id, inMeasure: passage.inMeasure, outMeasure: passage.outMeasure,
    playableParts: partsOf(passage.playableParts), printedMeasures: passage.printedMeasures, first: passage.id, last: passage.id, passages: [passage.id] }));
  const joins = [];
  while (level.length > 1) {
    const next = [];
    for (let at = 0; at < level.length; at += 2) {
      const left = level[at]; const right = level[at + 1];
      if (!right) { next.push(left); continue; }
      const join = { id: `join:${left.first}:${right.last}`, kind: 'join', final: false,
        inMeasure: left.inMeasure, outMeasure: right.outMeasure, playableParts: partsOf([...left.playableParts, ...right.playableParts]),
        printedMeasures: [left.printedMeasures?.[0], right.printedMeasures?.[1]].every((value) => value != null) ? [left.printedMeasures[0], right.printedMeasures[1]] : undefined,
        members: [left.id, right.id], memberPassages: [...left.passages, ...right.passages],
        seam: { left: left.outMeasure, right: right.inMeasure }, first: left.first, last: right.last, passages: [...left.passages, ...right.passages] };
      joins.push(join); next.push(join);
    }
    level = next;
  }
  if (joins.length) joins.at(-1).final = true;
  return joins.map(({ first, last, passages: _passages, ...join }) => join);
}

/** Every unit under a join, in play order: its passages and joins, then the join itself. */
function playOrder(id, byId) {
  const unit = byId.get(id);
  return unit?.kind === 'join' ? [...unit.members.flatMap((member) => playOrder(member, byId)), id] : [id];
}

export function createCoachPlan({ scoreId, fingerprint, segments = [], authoredLadder = false, tempoMap = [], criteria = {}, certification }) {
  const content = fingerprintOf(fingerprint);
  if (!scoreId || !content) throw new Error('Coaching requires a score and content fingerprint');
  const policy = normalizeCertification(certification);
  const plan = { version: COACH_VERSION, scoreId, fingerprint: content, authoredLadder, tempoMap, criteria: { ...criteria }, certification: policy, segments: [], tasks: [] };
  const noteStep = { track: 'silver', required: policy.silver.stepPasses, legacyRequired: LEGACY_STEP_PASSES };
  for (const segment of segments) {
    const parts = partsOf(segment.playableParts);
    if (!parts.length || !Number.isInteger(segment.inMeasure) || segment.outMeasure < segment.inMeasure) continue;
    const range = { start: segment.inMeasure, end: segment.outMeasure };
    const authored = authoredLadder || segment.authoredLadder === true;
    const specs = authored ? (segment.ladder ?? []).flatMap((rung) => {
      const percents = Array.from({ length: rung.sets }, (_, index) => rung.tempoPercents?.[index] ?? rung.tempoPercent);
      const staged = rung.mode !== 'free' && percents.some((percent) => percent !== percents[0]);
      const groups = staged ? percents.reduce((all, percent, index) => {
        if (all.at(-1)?.percent === percent) { all.at(-1).sets += 1; all.at(-1).end = index; }
        else all.push({ percent, start: index, end: index, sets: 1 });
        return all;
      }, []) : [{ percent: rung.tempoPercent, start: 0, end: rung.sets - 1, sets: rung.sets }];
      return groups.map((group, index) => ({
        track: 'silver', skill: staged ? `${rung.id}:set-${group.start + 1}` : rung.id, label: rung.label, parts: rung.effectiveParts ?? rung.parts,
        mode: rung.mode, tempoPercent: group.percent, criteria: rung.criteria,
        required: group.sets * rung.reps, consecutive: rung.consecutive,
        ...(staged ? { authoredSeries: rung.id, authoredStage: group.start, legacySkill: rung.id, legacyRequired: (group.end + 1) * rung.reps } : {}),
        completes: rung.completes === 'passage' && index === groups.length - 1,
        mastery: rung.mode === 'cued' && group.percent === 100 && sameParts(rung.effectiveParts ?? rung.parts, parts)
          && rung.completes === 'passage' && index === groups.length - 1,
      }));
    }) : [
      ...(parts.length > 1 ? parts.map((part) => ({ skill: part === 'rh' ? 'right' : part === 'lh' ? 'left' : `notes-${part}`,
        label: part === 'rh' ? 'Find the right-hand notes' : part === 'lh' ? 'Find the left-hand notes' : 'Find these notes', parts: [part], mode: 'free', ...noteStep })) : []),
      { skill: parts.length > 1 ? 'together' : 'notes', label: parts.length > 1 ? 'Join the hands' : 'Find the notes', parts, mode: 'free', ...noteStep },
      { skill: 'silver', label: 'Play it on your own', parts, mode: 'free', track: 'silver', assist: 'none', required: policy.silver.checkPasses, stallSeconds: policy.silver.stallSeconds,
        criteria: { completeness: 1, cleanliness: policy.silver.cleanliness } },
      { skill: 'pulse', label: 'Settle into a beat', parts, mode: 'metronome', tempoPercent: GOLD_TEMPOS[0], track: 'gold' },
      // Each hand with the beat before both (2026-11-22): a child who could play the
      // melody in time dropped the left hand the moment both were graded on the click.
      ...(parts.length > 1 ? parts.filter((part) => part === 'rh' || part === 'lh').map((part) => ({
        track: 'gold', skill: `timed-${GOLD_TEMPOS[0]}-${part}`, label: part === 'rh' ? 'Right hand with the beat' : 'Left hand with the beat',
        parts: [part], mode: 'cued', tempoPercent: GOLD_TEMPOS[0] })) : []),
      ...[...GOLD_TEMPOS, 100].map((tempoPercent) => ({ track: 'gold', skill: tempoPercent === 100 ? 'mastery' : `timed-${tempoPercent}`,
        label: tempoPercent === 100 ? 'Play at score tempo' : 'Play with the beat', parts, mode: 'cued', tempoPercent,
        mastery: tempoPercent === 100, completes: tempoPercent === 100 })),
    ];
    const tasks = specs.filter((spec) => spec.parts?.length && spec.parts.every((part) => parts.includes(part)))
      .map((spec) => makeCoachTask(plan, { ...spec, criteria: { ...criteria, ...spec.criteria }, passageId: segment.id, range }));
    const demonstration = tasks.find((task) => task.mastery) ?? makeCoachTask(plan, {
      passageId: segment.id, skill: 'optional-mastery', label: 'Play at score tempo', range, parts,
      mode: 'cued', tempoPercent: 100, criteria, mastery: true, source: 'demonstration',
    });
    plan.segments.push({ ...segment, authoredLadder: authored, tasks, demonstration });
    plan.tasks.push(...tasks, ...(tasks.includes(demonstration) ? [] : [demonstration]));
  }
  const joins = authoredLadder ? [] : buildJoinTree(plan.segments.filter((segment) => !segment.authoredLadder));
  if (joins.length === 0) return plan;
  const joinSegments = joins.map((join) => {
    const range = { start: join.inMeasure, end: join.outMeasure };
    const parts = join.playableParts;
    const specs = [
      ...(parts.length > 1 ? parts.map((part) => ({ skill: part === 'rh' ? 'right' : part === 'lh' ? 'left' : `notes-${part}`,
        label: part === 'rh' ? 'Find the right-hand notes' : part === 'lh' ? 'Find the left-hand notes' : 'Find these notes', parts: [part], mode: 'free', ...noteStep })) : []),
      { skill: parts.length > 1 ? 'together' : 'notes', label: parts.length > 1 ? 'Join the hands' : 'Find the notes', parts, mode: 'free', ...noteStep },
      { skill: 'silver', label: 'Play it on your own', parts, mode: 'free', track: 'silver', assist: 'none', required: policy.silver.checkPasses, stallSeconds: policy.silver.stallSeconds,
        criteria: { completeness: 1, cleanliness: policy.silver.cleanliness } },
    ];
    const tasks = specs.map((spec) => makeCoachTask(plan, { ...spec, criteria: { ...criteria, ...spec.criteria }, passageId: join.id, range }));
    plan.tasks.push(...tasks);
    return { ...join, authoredLadder: false, tasks, demonstration: null };
  });
  const byId = new Map([...plan.segments, ...joinSegments].map((segment) => [segment.id, segment]));
  const order = playOrder(joinSegments.at(-1).id, byId);
  const placed = new Set(order);
  plan.segments = [...order.map((id) => byId.get(id)), ...plan.segments.filter((segment) => !placed.has(segment.id))];
  return plan;
}

function stateFor(plan, state) {
  if (state?.version === COACH_VERSION && state.fingerprint === plan.fingerprint && state.scoreId === plan.scoreId) return state;
  return { version: COACH_VERSION, scoreId: plan.scoreId, fingerprint: plan.fingerprint, revision: 0,
    achievements: {}, counts: {}, evidence: [], reviews: {}, resume: null };
}

function validTask(plan, task) {
  const segment = plan.segments.find((item) => item.id === task?.passageId);
  return segment && task.scoreId === plan.scoreId && task.fingerprint === plan.fingerprint
    && Number.isInteger(task.range?.start) && Number.isInteger(task.range?.end)
    && task.range.start >= segment.inMeasure && task.range.end <= segment.outMeasure && task.range.end >= task.range.start
    && task.parts?.length && task.parts.every((part) => segment.playableParts.includes(part))
    && (task.assist == null || task.assist === 'none')
    && ['free', 'metronome', 'cued'].includes(task.mode)
    && (task.mode === 'free' || (Number.isFinite(task.tempoPercent) && task.tempoPercent > 0 && task.tempoPercent <= 100))
    && (task.depth ?? 0) <= MAX_DRILL_DEPTH;
}

function receivedInput(result) {
  return ['matched_notes', 'wrong_notes', 'offbeat_notes', 'early_notes', 'late_notes'].some((name) => result?.diagnostics?.[name] > 0);
}

function assessable(result, task) {
  if (result?.status !== 'completed' || result.validity === 'invalid' || !(result.diagnostics?.expected_notes > 0) || !receivedInput(result)) return false;
  return !(task.mode === 'cued' && task.parts.length > 1 && result.rubric?.version === '2'
    && result.inputContractVersion !== 'onsets-v1');
}

function passedFor(result, task) {
  return Object.entries(task.criteria).every(([criterion, threshold]) => Number.isFinite(result.criteria?.[criterion])
    && result.criteria[criterion] >= threshold);
}

function canProve(actual, wanted) {
  if (!sameRange(actual.range, wanted.range) || !sameParts(actual.parts, wanted.parts)) return false;
  if (wanted.assist === 'none' && actual.assist !== 'none') return false;
  if (wanted.mode === 'free') return true;
  if (wanted.mode === 'metronome') return actual.mode === 'metronome' || actual.mode === 'cued';
  return actual.mode === 'cued' && actual.tempoPercent >= wanted.tempoPercent;
}

function ready(state, task) {
  if (state.achievements[task.key]) return true;
  if (task.required != null) {
    const count = state.counts[task.key];
    return (task.consecutive ? count?.streak : count?.passes) >= task.required;
  }
  return state.evidence.filter((event) => event.eligible.includes(task.key)).slice(-3)
    .filter((event) => event.passedCredits.includes(task.key)).length >= 2;
}

function legacyReady(legacy, segment, task) {
  const passage = legacy?.learn?.passages?.[segment.id];
  if (passage?.complete || passage?.testedOut) return true;
  const id = task.legacySkill ?? (task.skill === 'timed-60' ? 'timed' : task.skill);
  const aliases = task.skill === 'notes' ? [task.parts[0] === 'lh' ? 'left' : 'right', 'together'] : [id];
  const oldRequired = task.legacyRequired ?? task.required ?? ({ timed: 3, mastery: 3, 'test-out': 3 }[id] ?? 6);
  return aliases.some((alias) => (passage?.rungs?.[alias]?.passCount ?? 0) >= oldRequired);
}

export const isGoldWork = (task) => task.mode !== 'free' && task.track !== 'silver';

/**
 * Whether an uncertified passage is partway there, by the plan's `flower.after`
 * policy. The note steps are the Silver steps before the hints-off check: each
 * hand alone and the whole passage. A one-part passage has only the whole.
 */
function partway(plan, segment, skills) {
  const steps = skills.filter((skill) => skill.track === 'silver' && skill.assist !== 'none');
  const whole = steps.filter((skill) => sameParts(skill.parts, segment.playableParts));
  const alone = steps.filter((skill) => !whole.includes(skill));
  const after = plan.certification?.flower?.after ?? CERTIFICATION_DEFAULTS.flower.after;
  if (after === 'first-step') return steps.some((skill) => skill.ready);
  if (whole.some((skill) => skill.ready)) return true;
  return after === 'both-hands' && alone.length > 0 && alone.every((skill) => skill.ready);
}

/**
 * One projected passage as every surface shows it: not started (`todo`), `learning`
 * (partway, by the flower policy) with its Silver steps counted, `silver` or `gold`. The home desk and the
 * sheet-music rail both read this, so they cannot disagree.
 */
export function passageProgress(segment) {
  const steps = (segment.skills ?? []).filter((skill) => skill.track === 'silver');
  const done = steps.filter((skill) => skill.ready).length;
  const state = segment.certification?.gold ? 'gold' : segment.certification?.silver ? 'silver' : segment.flower ? 'learning' : 'todo';
  return { id: segment.id, start: segment.inMeasure, end: segment.outMeasure, state, steps: { done, total: steps.length } };
}
const certificate = (achievement, provenance) => ({ at: achievement?.at ?? null, provenance });

/**
 * A generated Gold step the child has already proven, at its bars and parts, at an equal or
 * faster tempo: a later (faster) step of the ladder is ready, or an earned achievement covers it.
 * The achievement can belong to a step the ladder no longer has (the old 80%), so a change of
 * tempos never takes back a rung. A beat step is proven by any beat or cued work; a cued step
 * by cued work only. Mutates the projected `skills` in place.
 */
function carryGold(state, skills) {
  const earned = Object.keys(state.achievements).map((key) => { try { return JSON.parse(key); } catch { return null; } })
    .filter((key) => Array.isArray(key) && key[0] !== 'silver-check')
    .map(([scoreId, fingerprint, start, end, parts, mode, tempoPercent]) => ({ scoreId, fingerprint, range: { start, end }, parts, mode, tempoPercent }));
  const covers = (proof, task) => proof.scoreId === task.scoreId && proof.fingerprint === task.fingerprint
    && sameRange(proof.range, task.range) && task.parts.every((part) => proof.parts.includes(part))
    && (proof.mode === 'cued' || (task.mode === 'metronome' && proof.mode === 'metronome'))
    && Number.isFinite(proof.tempoPercent) && proof.tempoPercent >= task.tempoPercent;
  let faster = null;
  for (const skill of [...skills].reverse()) {
    if (skill.track !== 'gold' || (skill.mode !== 'cued' && skill.mode !== 'metronome')) continue;
    if (!skill.ready) {
      const proof = (faster && covers(faster, skill) ? faster : null) ?? earned.find((key) => covers(key, skill));
      if (proof) Object.assign(skill, { ready: true, provenance: skill.provenance ?? proof.provenance ?? 'demonstrated' });
    }
    if (skill.ready && skill.mode === 'cued' && (!faster || skill.tempoPercent > faster.tempoPercent)) faster = skill;
  }
}

/**
 * A generated note step the child has already proven by playing more of it: a ready note
 * step at the same bars whose parts include this step's parts. "Together" covers each hand
 * alone. Readiness only; no achievement is written, and the Silver check (the only way to
 * Silver) still has to be played. Mutates the projected `skills` in place.
 */
function carrySilver(skills) {
  const notes = skills.filter((skill) => skill.track === 'silver' && skill.assist !== 'none' && skill.mode === 'free');
  for (const skill of notes) {
    if (skill.ready) continue;
    const proof = notes.find((other) => other !== skill && other.ready && sameRange(other.range, skill.range)
      && other.parts.length > skill.parts.length && skill.parts.every((part) => other.parts.includes(part)));
    if (proof) Object.assign(skill, { ready: true, provenance: skill.provenance ?? 'demonstrated' });
  }
}

function segmentProjection(plan, state, legacy, segment) {
  const masteredAt = [segment.demonstration].filter(Boolean).filter((task) => task.mastery).map((task) => state.achievements[task.key]).find(Boolean);
  const old = legacy?.learn?.passages?.[segment.id];
  const legacyComplete = old?.complete === true || old?.testedOut === true;
  const legacyMastered = legacyComplete && !segment.authoredLadder;
  const mastered = Boolean(masteredAt || legacyMastered);
  const goldTask = segment.tasks.find((task) => task.mastery);
  const goldEarned = goldTask ? state.achievements[goldTask.key] : null;
  const gold = goldEarned ? certificate(goldEarned, goldEarned.provenance ?? 'demonstrated')
    : legacyComplete && goldTask ? certificate(null, 'legacy') : null;
  const silverTask = segment.tasks.find((task) => task.assist === 'none');
  const silverEarned = silverTask && (state.achievements[silverTask.key] || ready(state, silverTask));
  let silver = silverEarned ? certificate(state.achievements[silverTask.key], 'check')
    : gold ? certificate(gold, gold.provenance === 'legacy' ? 'legacy' : 'gold')
      : legacyComplete ? certificate(null, 'legacy') : null;
  const skills = segment.tasks.map((task) => {
    const inherited = legacyReady(legacy, segment, task);
    const certified = Boolean(silver) && task.track === 'silver';
    return { ...task, ready: (mastered && !segment.authoredLadder) || certified || ready(state, task) || inherited,
      provenance: state.achievements[task.key]?.provenance ?? (inherited ? 'legacy' : mastered || certified ? 'demonstrated' : null),
      successes: state.counts[task.key]?.passes ?? 0 };
  });
  if (!segment.authoredLadder) { carrySilver(skills); carryGold(state, skills); }
  const completed = skills.find((task) => task.completes && task.ready);
  if (!silver && segment.authoredLadder && completed) silver = certificate(state.achievements[completed.key], 'demonstrated');
  return { ...segment, skills, flower: !silver && partway(plan, segment, skills), mastered, complete: legacyComplete || (!segment.authoredLadder && mastered) || Boolean(completed),
    masteredAt: masteredAt?.at ?? null, certification: { silver, gold } };
}

function missedTwice(state, segment) {
  const recent = state.evidence.filter((item) => item.task.passageId === segment.id && !isGoldWork(item.task)).slice(-2);
  return recent.length === 2 && recent.every((item) => !item.passedCredits.includes(item.task.key));
}

/**
 * A saved generated-ladder Gold step (not a recovery drill, an authored ladder
 * or an explicit review) at a tempo the passage's current ladder has no step
 * for. The ladder was 60/80/100 until 2026-11; a child saved on `timed-80`
 * would otherwise resume it forever, since it is not a plan task.
 */
function offLadderGoldStep(segment, task) {
  if (task.review || task.parent || task.track !== 'gold' || !segment || segment.authoredLadder) return false;
  return !segment.tasks.some((step) => step.track === 'gold' && step.mode === task.mode && step.tempoPercent === task.tempoPercent);
}

function liveResume(plan, segments, task) {
  if (!validTask(plan, task)) return null;
  const canonical = plan.tasks.find((item) => item.key === task.key);
  const parent = segments.find((item) => item.id === task.passageId);
  if (!canonical && offLadderGoldStep(plan.segments.find((item) => item.id === task.passageId), task)) return null;
  return task.review || !canonical || !parent?.skills.find((item) => item.key === canonical.key)?.ready ? task : null;
}

/**
 * A Gold resume SAVED BEFORE the ladder gained each hand with the beat at 50%
 * (2026-11-22, `LADDER_REVISION` 2) that sits past one of those steps the child
 * has never tried. Without this, a child saved partway through both hands at 50%
 * resumes it and never meets the steps built for them. States written since carry
 * `ladder: 2`, so a child who now taps a later set keeps that choice.
 */
function bypassesUntriedGoldStep(segments, state, task) {
  if (!task || task.review || task.track !== 'gold') return false;
  let root = task;
  while (root.parent) root = root.parent;
  const segment = segments.find((item) => item.id === root.passageId);
  if (!segment || segment.authoredLadder) return false;
  const at = segment.skills.findIndex((skill) => skill.key === root.key);
  if (at < 0) return false;
  const tried = (key) => state.counts?.[key] != null
    || state.evidence.some((item) => item.task?.key === key || item.eligible?.includes(key));
  return segment.skills.slice(0, at).some((skill) => ONE_HAND_BEAT.test(skill.skill) && !skill.ready && !tried(skill.key));
}

export function projectCoach({ plan, state, legacy = {}, dayKey }) {
  const current = stateFor(plan, state);
  const compatibleLegacy = !legacy.fingerprint?.contentSha256 || legacy.fingerprint.contentSha256 === plan.fingerprint ? legacy : {};
  const segments = plan.segments.map((segment) => segmentProjection(plan, current, compatibleLegacy, segment));
  const due = segments.filter((segment) => segment.mastered && segment.masteredAt
    && (current.reviews[segment.id]?.dayKey ?? segment.masteredAt.slice(0, 10)) < dayKey)
    .sort((a, b) => (current.reviews[a.id]?.at ?? a.masteredAt).localeCompare(current.reviews[b.id]?.at ?? b.masteredAt));
  const reviewTask = due[0]?.demonstration;
  const review = reviewTask ? { ...reviewTask, review: true } : null;
  const setAsideToday = (id) => Boolean(dayKey) && current.setAside?.[id] === dayKey;
  const isJoin = (segment) => segment.kind === 'join';
  const passages = segments.filter((segment) => !isJoin(segment));
  const silverIds = new Set(passages.filter((segment) => segment.certification.silver).map((segment) => segment.id));
  // A join is offered only once every passage under it has its first (Bronze) certificate.
  const eligible = (segment) => !isJoin(segment) || segment.memberPassages.every((id) => silverIds.has(id));
  const open = segments.filter((segment) => !segment.certification.silver && eligible(segment));
  const resume = liveResume(plan, segments, current.resume);
  const drill = resume && resume.depth > 0 && !isGoldWork(resume)
    && open.some((segment) => segment.id === resume.passageId) && !setAsideToday(resume.passageId) ? resume : null;
  // Test out first: a unit nobody has touched opens on its hints-off check; once a take, a count
  // or any ready step exists (or the check was missed), it walks the hands first.
  const touched = (segment) => segment.skills.some((task) => task.track === 'silver' && task.assist !== 'none' && task.ready)
    || current.evidence.some((item) => item.task?.passageId === segment.id && !isGoldWork(item.task));
  const nextStep = (segment) => {
    const pending = segment.skills.filter((task) => task.track === 'silver' && !task.ready);
    return (!touched(segment) && pending.find((task) => task.assist === 'none')) || pending[0];
  };
  const inOrder = [...open.filter((segment) => !setAsideToday(segment.id)), ...open.filter((segment) => setAsideToday(segment.id))];
  const recommended = drill ?? inOrder.map(nextStep).find(Boolean) ?? null;
  const by = (value) => Object.fromEntries(segments.map((segment) => [segment.id, value(segment)]));
  const byPassage = (value) => Object.fromEntries(passages.map((segment) => [segment.id, value(segment)]));
  return { segments, recommended, review, state: current,
    goldResume: ((task) => ((current.ladder ?? 1) < LADDER_REVISION && bypassesUntriedGoldStep(segments, current, task) ? null : task))(liveResume(plan, segments, current.goldResume)),
    gold: byPassage((segment) => (segment.certification.gold ? null : segment.skills.find((task) => task.track === 'gold' && !task.ready) ?? null)),
    certifications: by((segment) => segment.certification),
    afterSetAside: byPassage((segment) => open.find((other) => other.id !== segment.id && !isJoin(other) && !setAsideToday(other.id))?.id ?? null),
    canSetAside: byPassage((segment) => !segment.certification.silver && !setAsideToday(segment.id) && missedTwice(current, segment)),
    piece: { total: passages.length,
      silver: passages.filter((segment) => segment.certification.silver).length,
      gold: passages.filter((segment) => segment.certification.gold).length,
      // Piece Silver is the whole piece played: the final join, or the one passage of a one-passage piece.
      joins: { total: segments.length - passages.length, silver: segments.filter((segment) => isJoin(segment) && segment.certification.silver).length },
      pieceSilver: Boolean((segments.find((segment) => segment.final) ?? (passages.length === 1 ? passages[0] : null))?.certification.silver),
      nextPassageId: open.find((segment) => !isJoin(segment))?.id ?? null,
      nextGoldPassageId: passages.find((segment) => !segment.certification.gold && segment.skills.some((task) => task.track === 'gold'))?.id ?? null },
    retainedLegacy: { passages: legacy.learn?.passages ?? {}, compatible: compatibleLegacy === legacy } };
}

const certificateStamp = (value) => (value ? value.at ?? 'legacy' : null);

/** The per-passage mastery other surfaces read, stored with each saved coaching event. */
export function coachSummary(projection, { now, state = projection.state }) {
  return { total: projection.piece.total, silver: projection.piece.silver, gold: projection.piece.gold,
    nextPassageId: projection.piece.nextPassageId, setAside: { ...(state?.setAside ?? {}) },
    joins: projection.piece.joins, pieceSilver: projection.piece.pieceSilver,
    passages: projection.segments.filter((segment) => segment.kind !== 'join').map((segment) => ({ id: segment.id, start: segment.inMeasure, end: segment.outMeasure, parts: segment.playableParts,
      silver: certificateStamp(segment.certification.silver), gold: certificateStamp(segment.certification.gold) })),
    updatedAt: now };
}

/**
 * A whole-beat shifted entry the run tested for on a failed cued take
 * (`result.entryShift`, browser performance/entryShift.js): +k beats late, −k
 * early, 0 when tested and none was named, null when the take was not tested.
 */
export function entryShiftBeats(result) {
  if (!result?.entryShift) return null;
  const beats = result.entryShift.beats;
  return Number.isInteger(beats) && Math.abs(beats) <= 2 ? beats : 0;
}
const SHIFT_WORDS = Object.freeze({ 1: 'one beat', 2: 'two beats' });

const burdenOf = (diagnostics = {}) => ((diagnostics.missed_notes ?? 0) + (diagnostics.wrong_notes ?? 0)) / (diagnostics.expected_notes || 1);
const HAND_GAP = 0.25;
/**
 * The smaller step after two misses on a whole join: the hand that broke across
 * the join when one hand is clearly worse than the other; otherwise the seam (the
 * last bar of the first unit and the first bar of the next) when the worst bar sits
 * on it. Null leaves the generic bar-then-hand ladder to run.
 */
function joinRecovery(join, task, result) {
  if (task.parts.length > 1) {
    const burdens = task.parts.map((part) => ({ part, burden: burdenOf(result.parts?.[part]?.diagnostics) })).sort((a, b) => b.burden - a.burden);
    if (burdens[0].burden - burdens[1].burden >= HAND_GAP) return { range: { ...task.range }, parts: [burdens[0].part], reason: 'one-hand' };
  }
  const worst = Object.entries(result.spans ?? {}).map(([id, span]) => ({ measure: Number(id.replace(/^measure:/, '')), burden: burdenOf(span.diagnostics), count: span.diagnostics?.expected_notes }))
    .filter((span) => Number.isInteger(span.measure) && span.count > 0 && span.burden > 0).sort((a, b) => b.burden - a.burden || a.measure - b.measure)[0];
  if (worst && (worst.measure === join.seam.left || worst.measure === join.seam.right)) {
    return { range: { start: join.seam.left, end: join.seam.right }, parts: [...task.parts], reason: 'seam' };
  }
  return null;
}

/**
 * The smaller step after two misses. Timing-only misses slow down. Otherwise the
 * hardest bar (for an unfinished take, the first bar it did not reach) is
 * practised with the bar before it, so the drill includes the way into it; when
 * that is already the task, the bar alone; a one-bar task drops to its harder hand.
 */
function recovery(plan, task, result) {
  if ((task.depth ?? 0) >= MAX_DRILL_DEPTH) return null;
  let range = { ...task.range };
  let parts = [...task.parts];
  let tempoPercent = task.tempoPercent;
  const timingOnly = task.mode === 'cued' && result.criteria?.completeness >= task.criteria.completeness
    && result.criteria?.cleanliness >= task.criteria.cleanliness;
  const join = plan.segments.find((segment) => segment.id === task.passageId && segment.kind === 'join');
  const joinDrill = join && !timingOnly && (task.depth ?? 0) === 0 && sameRange(range, { start: join.inMeasure, end: join.outMeasure })
    ? joinRecovery(join, task, result) : null;
  if (joinDrill) {
    range = joinDrill.range; parts = joinDrill.parts;
  } else if (timingOnly && tempoPercent > 40) {
    tempoPercent = SLOWER_TEMPOS.filter((value) => value < tempoPercent).at(-1) ?? 40;
  } else if (range.end > range.start) {
    // An unfinished take has every unreached bar fully missed, so the place it stopped is the first gap.
    const unfinished = task.mode === 'free' && (result.criteria?.completeness ?? 1) < 1;
    const spans = Object.entries(result.spans ?? {}).map(([id, span]) => ({
      measure: Number(id.replace(/^measure:/, '')), count: span.diagnostics?.expected_notes, missed: span.diagnostics?.missed_notes ?? 0,
      burden: ((span.diagnostics?.missed_notes ?? 0) + (span.diagnostics?.wrong_notes ?? 0)) / (span.diagnostics?.expected_notes || 1),
    })).filter((span) => Number.isInteger(span.measure) && span.measure >= range.start && span.measure <= range.end && span.count > 0)
      .filter((span) => !unfinished || span.missed > 0)
      .sort((a, b) => (unfinished ? 0 : b.burden - a.burden) || a.measure - b.measure);
    if (spans.length) {
      const hard = spans[0].measure;
      const linked = { start: Math.max(range.start, hard - 1), end: hard };
      range = sameRange(linked, range) ? { start: hard, end: hard } : linked;
    } else range = { start: range.start, end: range.start + Math.max(1, Math.ceil((range.end - range.start + 1) / 2)) - 1 };
  } else if (parts.length > 1) {
    parts.sort((a, b) => {
      const burden = (part) => {
        const d = result.parts?.[part]?.diagnostics ?? {};
        return ((d.missed_notes ?? 0) + (d.wrong_notes ?? 0)) / (d.expected_notes || 1);
      };
      return burden(b) - burden(a) || (a === 'rh' ? -1 : b === 'rh' ? 1 : a.localeCompare(b));
    });
    parts = parts.slice(0, 1);
  } else return null;
  const reason = joinDrill ? joinDrill.reason : timingOnly && tempoPercent !== task.tempoPercent ? 'slower-beat' : sameRange(range, task.range) ? 'one-hand' : 'focus-bars';
  return makeCoachTask(plan, { ...task, range, parts, tempoPercent, required: null, assist: null, stallSeconds: null, legacyRequired: null,
    label: reason === 'slower-beat' ? 'Try a little slower' : reason === 'one-hand' ? 'Practice one hand' : reason === 'seam' ? 'Practice the join' : 'Practice these bars',
    parent: task, depth: (task.depth ?? 0) + 1, reason, mastery: false, completes: false });
}

/**
 * Back-chaining: a passed drill on the closing bars of the step it came from
 * grows by one bar toward that step's start, so every take still ends on the
 * bars already learned. Null when the next bar back is the parent step itself,
 * or when the drill is not the parent's tail at the parent's hands and pace:
 * the drill then returns to its parent as before.
 */
function backChain(plan, task) {
  const parent = task.parent;
  if (!parent || task.mode !== parent.mode || task.tempoPercent !== parent.tempoPercent || !sameParts(task.parts, parent.parts)) return null;
  if (task.range.end !== parent.range.end || task.range.start <= parent.range.start) return null;
  const range = { start: task.range.start - 1, end: task.range.end };
  if (sameRange(range, parent.range)) return null;
  return makeCoachTask(plan, { ...task, range, reason: 'back-chain', label: 'Practice these bars' });
}

export function applyCoachEvent(state, event, options) {
  const before = stateFor(options.plan, state);
  const next = applyCoachEventToState(state, event, options);
  return next === before || next === state ? next : { ...next, ladder: LADDER_REVISION };
}

function applyCoachEventToState(state, event, { plan, now, dayKey, legacy = {} }) {
  const current = stateFor(plan, state);
  if (!event?.id || current.evidence.some((prior) => prior.id === event.id)) return current;
  if (!validTask(plan, event.task)) throw new Error('Invalid coaching task identity');
  const task = makeCoachTask(plan, event.task);
  const slot = isGoldWork(task) ? 'goldResume' : 'resume';
  // Starting a take on a passage set aside today brings it back: the learner chose
  // it, so it is coached again (smaller steps, and "come back later" once more).
  if (event.type === 'selection') {
    const { [task.passageId]: _returned, ...setAside } = current.setAside ?? {};
    return { ...current, revision: current.revision + 1, [slot]: task,
      ...(current.setAside?.[task.passageId] ? { setAside } : {}) };
  }
  if (event.type === 'set-aside') return { ...current, revision: current.revision + 1,
    setAside: { ...current.setAside, [task.passageId]: dayKey },
    resume: current.resume?.passageId === task.passageId ? null : current.resume ?? null };
  if (event.type !== 'outcome' || !assessable(event.result, task)) return current;
  const result = event.result;
  const candidates = plan.tasks.filter((candidate) => {
    if (!canProve(task, candidate)) return false;
    const segment = plan.segments.find((item) => item.id === candidate.passageId);
    if (!segment.authoredLadder || candidate.source === 'demonstration') return true;
    const currentTask = segment.tasks.find((item) => !ready(current, item) && !legacyReady(legacy, segment, item));
    return currentTask?.key === candidate.key;
  });
  const eligible = [...new Set([...candidates.map((candidate) => candidate.key), task.key])];
  const passedCredits = [...new Set([...candidates.filter((candidate) => passedFor(result, candidate)).map((candidate) => candidate.key),
    ...(passedFor(result, task) ? [task.key] : [])])];
  const entry = { id: event.id, task, at: now, dayKey, eligible, passedCredits,
    result: { criteria: result.criteria, diagnostics: result.diagnostics, spans: result.spans, parts: result.parts } };
  const next = { ...current, revision: current.revision + 1, evidence: [...current.evidence, entry].slice(-128),
    achievements: { ...current.achievements }, counts: { ...current.counts }, reviews: { ...current.reviews }, [slot]: task };
  for (const candidate of candidates) {
    const count = current.counts[candidate.key] ?? { attempts: 0, passes: 0, streak: 0 };
    const pass = passedCredits.includes(candidate.key);
    next.counts[candidate.key] = { attempts: count.attempts + 1, passes: count.passes + Number(pass), streak: pass ? count.streak + 1 : 0 };
    if (ready(next, candidate) && !next.achievements[candidate.key]) {
      next.achievements[candidate.key] = { at: now, dayKey, provenance: 'demonstrated', evidenceIds: next.evidence.filter((item) => item.passedCredits.includes(candidate.key)).slice(-3).map((item) => item.id) };
    }
  }
  if (task.mastery && passedCredits.includes(task.key)) next.reviews[task.passageId] = { at: now, dayKey };
  const equivalent = next.evidence.filter((item) => item.task.key === task.key);
  const successful = equivalent.slice(-3).filter((item) => item.passedCredits.includes(task.key)).length >= 2;
  if (task.parent && successful) next[slot] = backChain(plan, task) ?? task.parent;
  // A named shifted entry is a start that missed the count, not a passage too
  // hard to play: the same task again, never the smaller-task recovery.
  else if (equivalent.slice(-2).length === 2 && equivalent.slice(-2).every((item) => !item.passedCredits.includes(task.key))) {
    next[slot] = task.mode === 'cued' && entryShiftBeats(result) ? task : recovery(plan, task, result) ?? task;
  }
  else if (ready(next, task)) next[slot] = null;
  return next;
}

export function coachFeedback(result, task) {
  if (result?.validity === 'invalid' || result?.status === 'error') return {
    title: 'This take could not be checked', detail: 'Your progress is safe. Try again when the music is ready.', reason: 'operational',
  };
  if (result?.status === 'completed' && !receivedInput(result)) return {
    title: 'No notes were received', detail: 'Check the piano connection, then try when you’re ready. Your progress is safe.', reason: 'no-input',
  };
  if (task.assist === 'none') {
    const bars = `bars ${task.range.start + 1}-${task.range.end + 1}`;
    if (passedFor(result, task)) return { title: 'Silver!', detail: `You can play ${bars} on your own.`, reason: 'silver' };
    if ((result?.criteria?.completeness ?? 0) < task.criteria.completeness) {
      const measures = Object.entries(result?.spans ?? {}).filter(([, span]) => span.diagnostics?.missed_notes > 0)
        .map(([id]) => Number(id.replace(/^measure:/, ''))).filter(Number.isInteger);
      const bar = (measures.length ? Math.min(...measures) : task.range.start) + 1;
      return { title: `Bar ${bar} is the tricky spot`, detail: 'Practice that spot, then try again.', reason: 'stopped', bar };
    }
    return { title: 'Almost on your own', detail: 'Aim for fewer extra notes, then try again.', reason: 'notes' };
  }
  const shift = task.mode === 'cued' && !passedFor(result, task) ? entryShiftBeats(result) : 0;
  if (shift) {
    const words = SHIFT_WORDS[Math.abs(shift)];
    return shift > 0
      ? { title: 'Start on the click', detail: `You started ${words} late — start on the click after the count.`, reason: 'entry-late', entryShiftBeats: shift }
      : { title: 'Wait for the click', detail: `You started ${words} early — wait for the click after the count.`, reason: 'entry-early', entryShiftBeats: shift };
  }
  if (passedFor(result, task)) return { title: 'Nice work!',
    detail: task.mode === 'cued' ? 'You played the passage with the beat.' : task.mode === 'metronome' ? 'You found the notes with the click playing.' : 'You found all the notes.', reason: 'passed' };
  if ((result?.criteria?.completeness ?? 0) < task.criteria.completeness) return {
    title: 'Let’s find the missing notes', detail: 'Practice a smaller part, then try the passage again.', reason: 'coverage',
  };
  if ((result?.criteria?.cleanliness ?? 0) < task.criteria.cleanliness) return {
    title: 'Work on these notes', detail: 'Take your time and aim for fewer extra notes.', reason: 'notes',
  };
  return { title: 'The notes are there', detail: 'Let’s settle into the beat.', reason: 'timing' };
}
