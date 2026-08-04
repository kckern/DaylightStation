import { gradeAnswer } from '../grading.mjs';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SESSION_STATES = new Set(['offered', 'active', 'mastered', 'improved', 'exhausted', 'cancelled']);
const TERMINAL_STATES = new Set(['mastered', 'improved', 'exhausted', 'cancelled']);
const CHOICE_IDS = Object.freeze(['A', 'B', 'C', 'D', 'E']);
export const REMEDIATION_LEARNER_CONTROLS = Object.freeze([
  'stop', 'skip', 'explain', 'challenge',
]);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

export const DEFAULT_ADAPTIVE_REMEDIATION_POLICY = Object.freeze({
  enabled: true,
  launch: 'offer',
  trigger: Object.freeze({ scoreBelowPercent: 70, minimumIncorrect: 1 }),
  mastery: Object.freeze({ targetPercent: 80, minimumChecksPerConcept: 2 }),
  limits: Object.freeze({ maxTurns: 12, maxMinutes: 20, maxGenerationAttempts: 3 }),
  interaction: Object.freeze({
    responseMode: 'choice', maxChoices: 5,
    learnerControls: Object.freeze([...REMEDIATION_LEARNER_CONTROLS]),
  }),
  guidance: null,
});

/** Validate the subject-neutral policy authored on a quiz module. */
export function validateAdaptiveRemediationPolicy(raw, { path = 'remediation' } = {}) {
  if (!isObject(raw)) return { errors: [`${path}: must be a mapping`] };
  const errors = [];
  const policy = {
    enabled: raw.enabled ?? DEFAULT_ADAPTIVE_REMEDIATION_POLICY.enabled,
    launch: raw.launch ?? DEFAULT_ADAPTIVE_REMEDIATION_POLICY.launch,
    trigger: {
      ...DEFAULT_ADAPTIVE_REMEDIATION_POLICY.trigger,
      ...(isObject(raw.trigger) ? raw.trigger : {}),
    },
    mastery: {
      ...DEFAULT_ADAPTIVE_REMEDIATION_POLICY.mastery,
      ...(isObject(raw.mastery) ? raw.mastery : {}),
    },
    limits: {
      ...DEFAULT_ADAPTIVE_REMEDIATION_POLICY.limits,
      ...(isObject(raw.limits) ? raw.limits : {}),
    },
    interaction: {
      ...DEFAULT_ADAPTIVE_REMEDIATION_POLICY.interaction,
      ...(isObject(raw.interaction) ? raw.interaction : {}),
    },
    guidance: raw.guidance ?? null,
  };
  if (typeof policy.enabled !== 'boolean') errors.push(`${path}.enabled: must be boolean`);
  if (!['offer', 'automatic'].includes(policy.launch)) errors.push(`${path}.launch: must be offer|automatic`);
  if (raw.trigger !== undefined && !isObject(raw.trigger)) errors.push(`${path}.trigger: must be a mapping`);
  if (raw.mastery !== undefined && !isObject(raw.mastery)) errors.push(`${path}.mastery: must be a mapping`);
  if (raw.limits !== undefined && !isObject(raw.limits)) errors.push(`${path}.limits: must be a mapping`);
  if (raw.interaction !== undefined && !isObject(raw.interaction)) errors.push(`${path}.interaction: must be a mapping`);
  integerRange(policy.trigger.scoreBelowPercent, 1, 100, `${path}.trigger.scoreBelowPercent`, errors);
  integerRange(policy.trigger.minimumIncorrect, 1, 255, `${path}.trigger.minimumIncorrect`, errors);
  integerRange(policy.mastery.targetPercent, 50, 100, `${path}.mastery.targetPercent`, errors);
  integerRange(policy.mastery.minimumChecksPerConcept, 1, 10, `${path}.mastery.minimumChecksPerConcept`, errors);
  integerRange(policy.limits.maxTurns, 1, 50, `${path}.limits.maxTurns`, errors);
  integerRange(policy.limits.maxMinutes, 1, 120, `${path}.limits.maxMinutes`, errors);
  integerRange(policy.limits.maxGenerationAttempts, 1, 5, `${path}.limits.maxGenerationAttempts`, errors);
  if (policy.interaction.responseMode !== 'choice') {
    errors.push(`${path}.interaction.responseMode: v1 supports choice only`);
  }
  integerRange(policy.interaction.maxChoices, 2, 5, `${path}.interaction.maxChoices`, errors);
  if (!Array.isArray(policy.interaction.learnerControls)
      || policy.interaction.learnerControls.length === 0
      || new Set(policy.interaction.learnerControls).size !== policy.interaction.learnerControls.length
      || policy.interaction.learnerControls.some((control) => !REMEDIATION_LEARNER_CONTROLS.includes(control))) {
    errors.push(`${path}.interaction.learnerControls: must contain unique supported controls`);
  }
  if (policy.guidance !== null && (!isText(policy.guidance) || policy.guidance.length > 1000)) {
    errors.push(`${path}.guidance: must be 1..1000 characters when present`);
  }
  return errors.length ? { errors } : { errors, policy: deepFreeze(policy) };
}

/**
 * Deterministically grade one immutable assessment snapshot and identify the
 * concepts that need remediation. The model is never trusted for this step.
 */
export function evaluateAssessmentForRemediation({ policy, bank, responses }) {
  const errors = [];
  if (!isObject(policy)) errors.push('policy is required');
  if (!isObject(bank) || !Array.isArray(bank.items) || bank.items.length === 0) {
    errors.push('bank must contain items');
  }
  if (!Array.isArray(responses) || responses.length === 0) errors.push('responses must be non-empty');
  if (errors.length) return { errors };

  const definitions = new Map((bank.concepts ?? []).map((entry) => [entry.conceptId, entry]));
  const items = new Map(bank.items.map((item) => [item.id, item]));
  const evidence = new Map();
  let correct = 0;
  for (const [index, response] of responses.entries()) {
    const item = items.get(response?.itemId);
    if (!item) { errors.push(`responses[${index}].itemId is not in the bank`); continue; }
    if (!Array.isArray(item.concepts) || item.concepts.length === 0) {
      errors.push(`bank item '${item.id}' needs concepts when remediation is enabled`);
      continue;
    }
    let grade;
    try { grade = gradeAnswer(item, response.given); } catch (error) {
      errors.push(`response '${item.id}' cannot be graded: ${error.message}`);
      continue;
    }
    if (grade.correct) correct += 1;
    for (const conceptId of item.concepts) {
      const definition = definitions.get(conceptId);
      if (!definition) {
        errors.push(`bank item '${item.id}' references undefined concept '${conceptId}'`);
        continue;
      }
      const current = evidence.get(conceptId) ?? {
        conceptId,
        title: definition.title,
        description: definition.description ?? null,
        assessmentCorrect: 0,
        assessmentTotal: 0,
        assessmentPercent: 0,
        checksCorrect: 0,
        checksTotal: 0,
        masteryPercent: 0,
        mastered: false,
      };
      current.assessmentTotal += 1;
      if (grade.correct) current.assessmentCorrect += 1;
      evidence.set(conceptId, current);
    }
  }
  if (errors.length) return { errors };

  for (const entry of evidence.values()) {
    entry.assessmentPercent = percent(entry.assessmentCorrect, entry.assessmentTotal);
    entry.masteryPercent = entry.assessmentPercent;
  }
  const total = responses.length;
  const incorrect = total - correct;
  const scorePercent = percent(correct, total);
  const concepts = [...evidence.values()]
    .filter((entry) => entry.assessmentCorrect < entry.assessmentTotal)
    .sort((left, right) => (
      left.assessmentPercent - right.assessmentPercent
      || left.conceptId.localeCompare(right.conceptId)
    ));
  const triggered = policy.enabled === true
    && scorePercent < policy.trigger.scoreBelowPercent
    && incorrect >= policy.trigger.minimumIncorrect
    && concepts.length > 0;
  return {
    errors,
    evaluation: deepFreeze({ correct, incorrect, total, scorePercent, triggered, concepts }),
  };
}

/** Publication-time readiness check for a remediation-enabled assessment. */
export function validateAdaptiveRemediationBank(bank, { path = 'bank' } = {}) {
  const errors = [];
  if (!isObject(bank) || !Array.isArray(bank.items) || bank.items.length === 0) {
    return { errors: [`${path}: must contain assessment items`] };
  }
  const definitions = new Set((bank.concepts ?? []).map(({ conceptId }) => conceptId));
  if (definitions.size === 0) errors.push(`${path}.concepts: remediation requires concept definitions`);
  bank.items.forEach((item, index) => {
    const at = `${path}.items[${index}]`;
    if (!Array.isArray(item.concepts) || item.concepts.length === 0) {
      errors.push(`${at}.concepts: remediation requires at least one concept`);
      return;
    }
    item.concepts.forEach((conceptId) => {
      if (!definitions.has(conceptId)) errors.push(`${at}.concepts: unknown concept '${conceptId}'`);
    });
  });
  return { errors };
}

export function createAdaptiveRemediationSession({
  sessionId, learnerId, source, tutorContext, policy, evaluation, createdAt,
}) {
  if (!isText(sessionId) || !isText(learnerId) || !isObject(source)
      || !isText(source.externalId) || !isObject(tutorContext)
      || !isCanonicalTimestamp(createdAt)) {
    throw new TypeError('Adaptive remediation session identity/source/time is invalid');
  }
  if (!evaluation?.triggered || !Array.isArray(evaluation.concepts) || evaluation.concepts.length === 0) {
    throw new TypeError('Adaptive remediation session requires triggered concept evidence');
  }
  return deepFreeze({
    schema: 'school.adaptive-remediation-session/v1',
    sessionId,
    learnerId,
    source: structuredClone(source),
    // Immutable private context supplied to the tutor. The public view below
    // deliberately omits this because it may contain assessment answer keys.
    tutorContext: structuredClone(tutorContext),
    policy: structuredClone(policy),
    status: 'offered',
    initialScorePercent: evaluation.scorePercent,
    masteryPercent: average(evaluation.concepts.map(({ assessmentPercent }) => assessmentPercent)),
    concepts: structuredClone(evaluation.concepts),
    turns: [],
    currentTurnId: null,
    nextClientSequence: 0,
    nextServerSequence: 1,
    createdAt,
    activatedAt: null,
    updatedAt: createdAt,
    completedAt: null,
    completionReason: null,
  });
}

export function advanceAdaptiveRemediationClientSequence(session, {
  clientSequence, at,
}) {
  assertSession(session);
  if (clientSequence !== session.nextClientSequence || !isCanonicalTimestamp(at)) {
    throw new Error('Remediation client sequence cannot advance out of order');
  }
  return deepFreeze({
    ...structuredClone(session), nextClientSequence: clientSequence + 1, updatedAt: at,
  });
}

export function activateAdaptiveRemediationSession(session, { at }) {
  assertSession(session);
  if (session.status === 'active') return session;
  if (session.status !== 'offered') throw new Error(`Cannot activate remediation session in '${session.status}' state`);
  if (!isCanonicalTimestamp(at)) throw new TypeError('Remediation activation time is invalid');
  return deepFreeze({ ...structuredClone(session), status: 'active', activatedAt: at, updatedAt: at });
}

/** Add one validated compact tutor check; the answer key remains server-only. */
export function appendAdaptiveRemediationTurn(session, rawTurn, { turnId, at }) {
  assertSession(session);
  if (session.status !== 'active' || session.currentTurnId !== null) {
    throw new Error('Remediation session is not ready for another tutor turn');
  }
  if (!isText(turnId) || !isCanonicalTimestamp(at)) throw new TypeError('Tutor turn identity/time is invalid');
  const turn = validateTutorTurn(rawTurn, session);
  assertTutorTurnIsFresh(turn, session.turns);
  const next = structuredClone(session);
  next.turns.push({
    turnId,
    serverSequence: next.nextServerSequence,
    kind: 'check',
    conceptId: turn.conceptId,
    body: turn.body,
    prompt: turn.prompt,
    choices: turn.choices,
    correctChoiceId: turn.correctChoiceId,
    rationale: turn.rationale,
    createdAt: at,
    response: null,
  });
  next.currentTurnId = turnId;
  next.nextServerSequence += 1;
  next.updatedAt = at;
  return deepFreeze(next);
}

/**
 * Apply a learner-owned control to the current check without manufacturing a
 * right/wrong answer. Explain/skip/challenge can continue with a fresh turn;
 * stop is represented by cancelAdaptiveRemediationSession.
 */
export function controlAdaptiveRemediationTurn(session, { turnId, control, at }) {
  assertSession(session);
  if (session.status !== 'active' || session.currentTurnId !== turnId) {
    throw new Error('Remediation control does not identify the current turn');
  }
  if (!['skip', 'explain', 'challenge'].includes(control)
      || !session.policy.interaction.learnerControls.includes(control)) {
    throw new Error('Remediation learner control is not available');
  }
  if (!isCanonicalTimestamp(at)) throw new TypeError('Remediation control time is invalid');
  const next = structuredClone(session);
  const turn = next.turns.find((entry) => entry.turnId === turnId);
  if (!turn || turn.response !== null) throw new Error('Remediation turn is missing or already answered');
  turn.response = { control, respondedAt: at };
  next.currentTurnId = null;
  next.updatedAt = at;
  const terminal = terminalOutcome(next, at);
  if (terminal) {
    next.status = terminal.status;
    next.completionReason = terminal.reason;
    next.completedAt = at;
  }
  return deepFreeze({
    session: deepFreeze(next),
    result: deepFreeze({ turnId, conceptId: turn.conceptId, control, status: next.status }),
  });
}

export function answerAdaptiveRemediationTurn(session, { turnId, choiceId, at }) {
  assertSession(session);
  if (session.status !== 'active' || session.currentTurnId !== turnId) {
    throw new Error('Remediation response does not identify the current turn');
  }
  if (!isCanonicalTimestamp(at)) throw new TypeError('Remediation response time is invalid');
  const next = structuredClone(session);
  const turn = next.turns.find((entry) => entry.turnId === turnId);
  if (!turn || turn.response !== null) throw new Error('Remediation turn is missing or already answered');
  if (!turn.choices.some(({ id }) => id === choiceId)) throw new Error('Remediation choice is not available');
  const correct = choiceId === turn.correctChoiceId;
  turn.response = { choiceId, correct, respondedAt: at };
  next.currentTurnId = null;
  const concept = next.concepts.find(({ conceptId }) => conceptId === turn.conceptId);
  concept.checksTotal += 1;
  if (correct) concept.checksCorrect += 1;
  concept.masteryPercent = percent(concept.checksCorrect, concept.checksTotal);
  concept.mastered = concept.checksTotal >= next.policy.mastery.minimumChecksPerConcept
    && concept.masteryPercent >= next.policy.mastery.targetPercent;
  next.masteryPercent = currentMasteryPercent(next.concepts);
  next.updatedAt = at;
  const terminal = terminalOutcome(next, at);
  if (terminal) {
    next.status = terminal.status;
    next.completionReason = terminal.reason;
    next.completedAt = at;
  }
  return deepFreeze({
    session: deepFreeze(next),
    result: deepFreeze({
      turnId, conceptId: turn.conceptId, choiceId, correct,
      rationale: turn.rationale,
      masteryPercent: next.masteryPercent,
      status: next.status,
    }),
  });
}

export function cancelAdaptiveRemediationSession(session, { at }) {
  assertSession(session);
  if (TERMINAL_STATES.has(session.status)) return session;
  if (!isCanonicalTimestamp(at)) throw new TypeError('Remediation cancellation time is invalid');
  return deepFreeze({
    ...structuredClone(session), status: 'cancelled', completionReason: 'learner_cancelled',
    completedAt: at, updatedAt: at, currentTurnId: null,
  });
}

export function selectNextRemediationConcept(session) {
  assertSession(session);
  if (session.status !== 'active') return null;
  return [...session.concepts]
    .filter(({ mastered }) => !mastered)
    .sort((left, right) => (
      left.masteryPercent - right.masteryPercent
      || left.checksTotal - right.checksTotal
      || left.conceptId.localeCompare(right.conceptId)
    ))[0] ?? null;
}

/** Client-safe view: an unanswered turn never exposes its answer or rationale. */
export function adaptiveRemediationSessionView(session) {
  assertSession(session);
  return deepFreeze({
    schema: session.schema,
    sessionId: session.sessionId,
    learnerId: session.learnerId,
    source: structuredClone(session.source),
    status: session.status,
    launch: session.policy.launch,
    initialScorePercent: session.initialScorePercent,
    masteryPercent: session.masteryPercent,
    targetPercent: session.policy.mastery.targetPercent,
    learnerControls: Object.freeze([...session.policy.interaction.learnerControls]),
    concepts: session.concepts.map((concept) => ({
      conceptId: concept.conceptId,
      title: concept.title,
      masteryPercent: concept.masteryPercent,
      checksTotal: concept.checksTotal,
      mastered: concept.mastered,
    })),
    turns: session.turns.map((turn) => ({
      turnId: turn.turnId,
      serverSequence: turn.serverSequence,
      kind: turn.kind,
      conceptId: turn.conceptId,
      body: turn.body,
      prompt: turn.prompt,
      choices: structuredClone(turn.choices),
      ...(turn.response ? {
        response: structuredClone(turn.response),
        rationale: turn.rationale,
      } : {}),
    })),
    currentTurnId: session.currentTurnId,
    nextClientSequence: session.nextClientSequence,
    nextServerSequence: session.nextServerSequence,
    createdAt: session.createdAt,
    activatedAt: session.activatedAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt,
    completionReason: session.completionReason,
    ...(TERMINAL_STATES.has(session.status) ? { terminalSummary: terminalSummary(session) } : {}),
  });
}

export function isAdaptiveRemediationTerminal(status) { return TERMINAL_STATES.has(status); }

function validateTutorTurn(raw, session) {
  if (!isObject(raw)) throw new TypeError('Tutor turn must be a mapping');
  const concept = session.concepts.find(({ conceptId }) => conceptId === raw.conceptId);
  if (!concept || concept.mastered) throw new TypeError('Tutor turn concept is not an active weak concept');
  compactText(raw.body, 360, 'Tutor turn body');
  compactText(raw.prompt, 240, 'Tutor turn prompt');
  compactText(raw.rationale, 360, 'Tutor turn rationale');
  if (!Array.isArray(raw.choices) || raw.choices.length < 2
      || raw.choices.length > session.policy.interaction.maxChoices) {
    throw new TypeError(`Tutor turn must contain 2..${session.policy.interaction.maxChoices} choices`);
  }
  const labels = new Set();
  raw.choices.forEach((choice, index) => {
    if (!isObject(choice) || choice.id !== CHOICE_IDS[index]) {
      throw new TypeError('Tutor choice IDs must be ordered A..E');
    }
    compactText(choice.label, 23, `Tutor choice ${choice.id}`);
    if (labels.has(choice.label)) throw new TypeError('Tutor choice labels must be unique');
    labels.add(choice.label);
  });
  if (!raw.choices.some(({ id }) => id === raw.correctChoiceId)) {
    throw new TypeError('Tutor correctChoiceId must identify one choice');
  }
  return structuredClone(raw);
}

function assertTutorTurnIsFresh(turn, priorTurns) {
  const signature = tutorTurnSignature(turn);
  const prompt = normalizedWords(turn.prompt);
  const repeated = priorTurns.some((prior) => {
    const priorSignature = tutorTurnSignature(prior);
    const priorPrompt = normalizedWords(prior.prompt);
    return signature === priorSignature || prompt === priorPrompt
      || wordSetSimilarity(signature, priorSignature) >= 0.86;
  });
  if (repeated) {
    const error = new TypeError('Tutor turn repeats an earlier explanation or check');
    error.code = 'REMEDIATION_TURN_REPETITION';
    throw error;
  }
}

function tutorTurnSignature(turn) {
  return normalizedWords(`${turn.body} ${turn.prompt} ${(turn.choices ?? []).map(({ label }) => label).join(' ')}`);
}

function normalizedWords(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function wordSetSimilarity(left, right) {
  const a = new Set(left.split(' ').filter(Boolean));
  const b = new Set(right.split(' ').filter(Boolean));
  if (a.size < 6 || b.size < 6) return 0;
  let intersection = 0;
  a.forEach((word) => { if (b.has(word)) intersection += 1; });
  return (2 * intersection) / (a.size + b.size);
}

function terminalOutcome(session, at) {
  if (session.concepts.every(({ mastered }) => mastered)) {
    return { status: 'mastered', reason: 'mastery_target_reached' };
  }
  if (session.turns.length >= session.policy.limits.maxTurns) {
    return improvementOutcome(session, 'turn_limit_reached');
  }
  const elapsed = new Date(at).valueOf() - new Date(session.activatedAt).valueOf();
  if (elapsed >= session.policy.limits.maxMinutes * 60_000) {
    return improvementOutcome(session, 'time_limit_reached');
  }
  return null;
}

function improvementOutcome(session, reason) {
  return {
    status: session.masteryPercent > initialConceptPercent(session.concepts)
      ? 'improved' : 'exhausted',
    reason,
  };
}

function terminalSummary(session) {
  const finalMasteryPercent = session.masteryPercent;
  const masteredConceptIds = session.concepts.filter(({ mastered }) => mastered)
    .map(({ conceptId }) => conceptId);
  const remainingConceptIds = session.concepts.filter(({ mastered }) => !mastered)
    .map(({ conceptId }) => conceptId);
  return Object.freeze({
    initialScorePercent: session.initialScorePercent,
    finalMasteryPercent,
    changePercent: finalMasteryPercent - initialConceptPercent(session.concepts),
    masteredConceptIds: Object.freeze(masteredConceptIds),
    remainingConceptIds: Object.freeze(remainingConceptIds),
    completionReason: session.completionReason,
    nextAction: session.status === 'mastered' ? 'continue' : 'review',
  });
}

function currentMasteryPercent(concepts) {
  return average(concepts.map((concept) => (
    concept.checksTotal > 0 ? concept.masteryPercent : concept.assessmentPercent
  )));
}

function initialConceptPercent(concepts) {
  return average(concepts.map(({ assessmentPercent }) => assessmentPercent));
}

function assertSession(session) {
  if (!isObject(session) || session.schema !== 'school.adaptive-remediation-session/v1'
      || !SESSION_STATES.has(session.status) || !Array.isArray(session.concepts)
      || !Array.isArray(session.turns)) {
    throw new TypeError('Adaptive remediation session is invalid');
  }
}

function compactText(value, maxLength, label) {
  if (!isText(value) || value.length > maxLength || !/^[\x20-\x7E\n]+$/.test(value)) {
    throw new TypeError(`${label} must be 1..${maxLength} printable ASCII characters`);
  }
}

function integerRange(value, minimum, maximum, path, errors) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    errors.push(`${path}: must be an integer from ${minimum}-${maximum}`);
  }
}

function percent(correct, total) { return total === 0 ? 0 : Math.round((correct / total) * 100); }
function average(values) { return values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length); }
function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
