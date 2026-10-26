/** Versioned, deterministic teaching policy. No clocks, IO, MIDI or React. */
export const COACH_VERSION = 1;
const PITCH = Object.freeze({ completeness: 1, cleanliness: 0.8 });
const TIMED = Object.freeze({ ...PITCH, placement: 0.8 });
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
    ...(spec.review ? { review: true } : {}), ...(spec.source ? { source: spec.source } : {}),
    ...(spec.reason ? { reason: spec.reason } : {}),
  };
  return { ...task, key: coachTaskKey(task) };
}

export function createCoachPlan({ scoreId, fingerprint, segments = [], authoredLadder = false, tempoMap = [], criteria = {} }) {
  const content = fingerprintOf(fingerprint);
  if (!scoreId || !content) throw new Error('Coaching requires a score and content fingerprint');
  const plan = { version: COACH_VERSION, scoreId, fingerprint: content, authoredLadder, tempoMap, criteria: { ...criteria }, segments: [], tasks: [] };
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
        skill: staged ? `${rung.id}:set-${group.start + 1}` : rung.id, label: rung.label, parts: rung.effectiveParts ?? rung.parts,
        mode: rung.mode, tempoPercent: group.percent, criteria: rung.criteria,
        required: group.sets * rung.reps, consecutive: rung.consecutive,
        ...(staged ? { authoredSeries: rung.id, authoredStage: group.start, legacySkill: rung.id, legacyRequired: (group.end + 1) * rung.reps } : {}),
        completes: rung.completes === 'passage' && index === groups.length - 1,
        mastery: rung.mode === 'cued' && group.percent === 100 && sameParts(rung.effectiveParts ?? rung.parts, parts)
          && rung.completes === 'passage' && index === groups.length - 1,
      }));
    }) : [
      ...(parts.length > 1 ? parts.map((part) => ({ skill: part === 'rh' ? 'right' : part === 'lh' ? 'left' : `notes-${part}`,
        label: part === 'rh' ? 'Find the right-hand notes' : part === 'lh' ? 'Find the left-hand notes' : 'Find these notes', parts: [part], mode: 'free' })) : []),
      { skill: parts.length > 1 ? 'together' : 'notes', label: parts.length > 1 ? 'Join the hands' : 'Find the notes', parts, mode: 'free' },
      { skill: 'pulse', label: 'Settle into a beat', parts, mode: 'metronome', tempoPercent: 60 },
      ...[60, 80, 100].map((tempoPercent) => ({ skill: tempoPercent === 100 ? 'mastery' : `timed-${tempoPercent}`,
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

function segmentProjection(plan, state, legacy, segment) {
  const masteredAt = [segment.demonstration].filter(Boolean).filter((task) => task.mastery).map((task) => state.achievements[task.key]).find(Boolean);
  const old = legacy?.learn?.passages?.[segment.id];
  const legacyComplete = old?.complete === true || old?.testedOut === true;
  const legacyMastered = legacyComplete && !segment.authoredLadder;
  const mastered = Boolean(masteredAt || legacyMastered);
  const skills = segment.tasks.map((task) => {
    const inherited = legacyReady(legacy, segment, task);
    return { ...task, ready: (mastered && !segment.authoredLadder) || ready(state, task) || inherited,
      provenance: state.achievements[task.key]?.provenance ?? (inherited ? 'legacy' : mastered ? 'demonstrated' : null),
      successes: state.counts[task.key]?.passes ?? 0 };
  });
  return { ...segment, skills, mastered, complete: legacyComplete || (!segment.authoredLadder && mastered)
    || skills.some((task) => task.completes && task.ready), masteredAt: masteredAt?.at ?? null };
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
  let recommended = null;
  if (validTask(plan, current.resume)) {
    const canonical = plan.tasks.find((task) => task.key === current.resume.key);
    const parentSegment = segments.find((item) => item.id === current.resume.passageId);
    if (current.resume.review || !canonical || !parentSegment?.skills.find((item) => item.key === canonical.key)?.ready) recommended = current.resume;
  }
  recommended ??= segments.flatMap((segment) => segment.skills).find((task) => !task.ready) ?? null;
  return { segments, recommended, review, state: current,
    retainedLegacy: { passages: legacy.learn?.passages ?? {}, compatible: compatibleLegacy === legacy } };
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
    const spans = Object.entries(result.spans ?? {}).map(([id, span]) => ({
      measure: Number(id.replace(/^measure:/, '')), count: span.diagnostics?.expected_notes,
      burden: ((span.diagnostics?.missed_notes ?? 0) + (span.diagnostics?.wrong_notes ?? 0)) / (span.diagnostics?.expected_notes || 1),
    })).filter((span) => Number.isInteger(span.measure) && span.measure >= range.start && span.measure <= range.end && span.count > 0)
      .sort((a, b) => b.burden - a.burden || a.measure - b.measure);
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
  return makeCoachTask(plan, { ...task, range, parts, tempoPercent, required: null,
    label: reason === 'slower-beat' ? 'Try a little slower' : reason === 'one-hand' ? 'Practice one hand' : 'Practice these bars',
    parent: task, depth: (task.depth ?? 0) + 1, reason, mastery: false, completes: false });
}

export function applyCoachEvent(state, event, { plan, now, dayKey, legacy = {} }) {
  const current = stateFor(plan, state);
  if (!event?.id || current.evidence.some((prior) => prior.id === event.id)) return current;
  if (!validTask(plan, event.task)) throw new Error('Invalid coaching task identity');
  const task = makeCoachTask(plan, event.task);
  if (event.type === 'selection') return { ...current, revision: current.revision + 1, resume: task };
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
    achievements: { ...current.achievements }, counts: { ...current.counts }, reviews: { ...current.reviews }, resume: task };
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
  if (task.parent && successful) next.resume = task.parent;
  else if (equivalent.slice(-2).length === 2 && equivalent.slice(-2).every((item) => !item.passedCredits.includes(task.key))) next.resume = recovery(plan, task, result) ?? task;
  else if (ready(next, task)) next.resume = null;
  return next;
}

export function coachFeedback(result, task) {
  if (result?.validity === 'invalid' || result?.status === 'error') return {
    title: 'This take could not be checked', detail: 'Your progress is safe. Try again when the music is ready.', reason: 'operational',
  };
  if (result?.status === 'completed' && !receivedInput(result)) return {
    title: 'No notes were received', detail: 'Check the piano connection, then try when you’re ready. Your progress is safe.', reason: 'no-input',
  };
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
