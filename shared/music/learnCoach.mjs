/** Versioned, deterministic teaching policy. No clocks, IO, MIDI or React. */
export const COACH_VERSION = 1;
const PITCH = Object.freeze({ completeness: 1, cleanliness: 0.8 });
const TIMED = Object.freeze({ ...PITCH, placement: 0.8 });
export const CERTIFICATION_DEFAULTS = Object.freeze({
  silver: Object.freeze({ stepPasses: 1, checkPasses: 1, cleanliness: 0.8, stallSeconds: 30 }),
});
const LEGACY_STEP_PASSES = 6;
const MAX_POLICY_PASSES = 20;
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
  } };
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
      { skill: 'pulse', label: 'Settle into a beat', parts, mode: 'metronome', tempoPercent: 60, track: 'gold' },
      ...[60, 80, 100].map((tempoPercent) => ({ track: 'gold', skill: tempoPercent === 100 ? 'mastery' : `timed-${tempoPercent}`,
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
    && (task.depth ?? 0) <= 2;
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

const isGoldWork = (task) => task.mode !== 'free' && task.track !== 'silver';
const certificate = (achievement, provenance) => ({ at: achievement?.at ?? null, provenance });

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
  const completed = skills.find((task) => task.completes && task.ready);
  if (!silver && segment.authoredLadder && completed) silver = certificate(state.achievements[completed.key], 'demonstrated');
  return { ...segment, skills, mastered, complete: legacyComplete || (!segment.authoredLadder && mastered) || Boolean(completed),
    masteredAt: masteredAt?.at ?? null, certification: { silver, gold } };
}

function missedTwice(state, segment) {
  const recent = state.evidence.filter((item) => item.task.passageId === segment.id && !isGoldWork(item.task)).slice(-2);
  return recent.length === 2 && recent.every((item) => !item.passedCredits.includes(item.task.key));
}

function liveResume(plan, segments, task) {
  if (!validTask(plan, task)) return null;
  const canonical = plan.tasks.find((item) => item.key === task.key);
  const parent = segments.find((item) => item.id === task.passageId);
  return task.review || !canonical || !parent?.skills.find((item) => item.key === canonical.key)?.ready ? task : null;
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
  const open = segments.filter((segment) => !segment.certification.silver);
  const resume = liveResume(plan, segments, current.resume);
  const drill = resume && resume.depth > 0 && !isGoldWork(resume)
    && open.some((segment) => segment.id === resume.passageId) && !setAsideToday(resume.passageId) ? resume : null;
  const nextStep = (segment) => segment.skills.find((task) => task.track === 'silver' && !task.ready);
  const inOrder = [...open.filter((segment) => !setAsideToday(segment.id)), ...open.filter((segment) => setAsideToday(segment.id))];
  const recommended = drill ?? inOrder.map(nextStep).find(Boolean) ?? null;
  const by = (value) => Object.fromEntries(segments.map((segment) => [segment.id, value(segment)]));
  return { segments, recommended, review, state: current,
    goldResume: liveResume(plan, segments, current.goldResume),
    gold: by((segment) => (segment.certification.gold ? null : segment.skills.find((task) => task.track === 'gold' && !task.ready) ?? null)),
    certifications: by((segment) => segment.certification),
    canSetAside: by((segment) => !segment.certification.silver && !setAsideToday(segment.id) && missedTwice(current, segment)),
    piece: { total: segments.length,
      silver: segments.filter((segment) => segment.certification.silver).length,
      gold: segments.filter((segment) => segment.certification.gold).length,
      nextPassageId: open[0]?.id ?? null,
      nextGoldPassageId: segments.find((segment) => !segment.certification.gold && segment.skills.some((task) => task.track === 'gold'))?.id ?? null },
    retainedLegacy: { passages: legacy.learn?.passages ?? {}, compatible: compatibleLegacy === legacy } };
}

const certificateStamp = (value) => (value ? value.at ?? 'legacy' : null);

/** The per-passage mastery other surfaces read, stored with each saved coaching event. */
export function coachSummary(projection, { now, state = projection.state }) {
  return { total: projection.piece.total, silver: projection.piece.silver, gold: projection.piece.gold,
    nextPassageId: projection.piece.nextPassageId, setAside: { ...(state?.setAside ?? {}) },
    passages: projection.segments.map((segment) => ({ id: segment.id, start: segment.inMeasure, end: segment.outMeasure,
      silver: certificateStamp(segment.certification.silver), gold: certificateStamp(segment.certification.gold) })),
    updatedAt: now };
}

function recovery(plan, task, result) {
  if ((task.depth ?? 0) >= 2) return null;
  let range = { ...task.range };
  let parts = [...task.parts];
  let tempoPercent = task.tempoPercent;
  const timingOnly = task.mode === 'cued' && result.criteria?.completeness >= task.criteria.completeness
    && result.criteria?.cleanliness >= task.criteria.cleanliness;
  if (timingOnly && tempoPercent > 40) {
    tempoPercent = [40, 60, 80, 100].filter((value) => value < tempoPercent).at(-1) ?? 40;
  } else if (range.end > range.start) {
    // An unfinished take has every unreached bar fully missed, so the place it stopped is the first gap.
    const unfinished = task.mode === 'free' && (result.criteria?.completeness ?? 1) < 1;
    const spans = Object.entries(result.spans ?? {}).map(([id, span]) => ({
      measure: Number(id.replace(/^measure:/, '')), count: span.diagnostics?.expected_notes, missed: span.diagnostics?.missed_notes ?? 0,
      burden: ((span.diagnostics?.missed_notes ?? 0) + (span.diagnostics?.wrong_notes ?? 0)) / (span.diagnostics?.expected_notes || 1),
    })).filter((span) => Number.isInteger(span.measure) && span.measure >= range.start && span.measure <= range.end && span.count > 0)
      .filter((span) => !unfinished || span.missed > 0)
      .sort((a, b) => (unfinished ? 0 : b.burden - a.burden) || a.measure - b.measure);
    range = spans.length ? { start: spans[0].measure, end: spans[0].measure }
      : { start: range.start, end: range.start + Math.max(1, Math.ceil((range.end - range.start + 1) / 2)) - 1 };
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
  const reason = timingOnly && tempoPercent !== task.tempoPercent ? 'slower-beat' : sameRange(range, task.range) ? 'one-hand' : 'focus-bars';
  return makeCoachTask(plan, { ...task, range, parts, tempoPercent, required: null, assist: null, stallSeconds: null, legacyRequired: null,
    label: reason === 'slower-beat' ? 'Try a little slower' : reason === 'one-hand' ? 'Practice one hand' : 'Practice these bars',
    parent: task, depth: (task.depth ?? 0) + 1, reason, mastery: false, completes: false });
}

export function applyCoachEvent(state, event, { plan, now, dayKey, legacy = {} }) {
  const current = stateFor(plan, state);
  if (!event?.id || current.evidence.some((prior) => prior.id === event.id)) return current;
  if (!validTask(plan, event.task)) throw new Error('Invalid coaching task identity');
  const task = makeCoachTask(plan, event.task);
  const slot = isGoldWork(task) ? 'goldResume' : 'resume';
  if (event.type === 'selection') return { ...current, revision: current.revision + 1, [slot]: task };
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
  if (task.parent && successful) next[slot] = task.parent;
  else if (equivalent.slice(-2).length === 2 && equivalent.slice(-2).every((item) => !item.passedCredits.includes(task.key))) next[slot] = recovery(plan, task, result) ?? task;
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
