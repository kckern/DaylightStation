/** Pure rules for a course combining card practice and paper assessment. */
const REF = /^print\/[a-z0-9][a-z0-9_-]*@[a-f0-9]{9}$/;
const CARD = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DECK = /^[a-z0-9][a-z0-9._/-]{0,127}$/;
const mapping = (v) => v && typeof v === 'object' && !Array.isArray(v);
const distinct = (v) => Array.isArray(v) && v.length > 0 && v.every((id) => typeof id === 'string' && CARD.test(id)) && new Set(v).size === v.length;
export function validatePracticeAssessment(raw) {
  if (raw.practice === undefined && raw.assessmentForms === undefined) return { errors: [] };
  const errors = [];
  const p = raw.practice;
  if (!mapping(p)) return { errors: ['practice must be a mapping'] };
  if (p.programId !== 'flashcards') errors.push('practice.programId must be flashcards');
  if (!DECK.test(p.deckId ?? '')) errors.push('practice.deckId must be a content reference');
  if (!distinct(p.requiredCardIds)) errors.push('practice.requiredCardIds must contain unique card identifiers');
  if (!mapping(p.questionCards) || !Object.keys(p.questionCards).length) errors.push('practice.questionCards must be a nonempty mapping');
  for (const [id, link] of Object.entries(p.questionCards ?? {})) {
    if (!CARD.test(id)) errors.push(`practice question id ${id} is invalid`);
    if (!mapping(link) || !distinct(link.cardIds)) { errors.push(`practice.questionCards.${id}.cardIds must be unique card identifiers`); continue; }
    for (const card of link.cardIds) if (!p.requiredCardIds?.includes(card)) errors.push(`practice question ${id} references unknown card ${card}`);
    if (!['application', 'vocabulary'].includes(link.kind)) errors.push(`practice question ${id} kind must be application|vocabulary`);
    if (typeof link.explanation !== 'string' || !link.explanation.trim()) errors.push(`practice question ${id} needs an explanation`);
  }
  if (!raw.document || !REF.test(raw.document)) errors.push('practice requires a pinned print document');
  if (raw.program || raw.launch || raw.activity || raw.media || raw.bank) errors.push('practice assessment is exclusive with program/launch/activity/media/bank');
  if (raw.passing?.percent !== 100) errors.push('practice assessment requires passing.percent: 100');
  const forms = raw.assessmentForms;
  if (!Array.isArray(forms) || forms.length < 2 || forms.some((f) => !REF.test(f)) || new Set(forms).size !== forms.length) errors.push('assessmentForms must contain at least two distinct pinned print references');
  else {
    if (forms[0] !== raw.document) errors.push('assessmentForms[0] must equal document');
    if (raw.retry?.variants !== forms.length) errors.push('retry.variants must match assessmentForms length');
  }
  return errors.length ? { errors } : { errors, practice: structuredClone(p), assessmentForms: [...forms] };
}

/** Snapshot-based cumulative credits; the latest effective verdict per question wins. */
export function projectPracticeAssessment({ unit, status = {}, sessions = [], dayFiles = [], readinessKnown = true }) {
  const history = sessions.filter((s) => s.unitId === unit.unitId && !s.evidenceInvalidated && !s.replacedBySessionId);
  const frozen = history.find((s) => s.practiceAssessment)?.practiceAssessment;
  const practice = frozen?.practice ?? unit.practice;
  const questionIds = Object.keys(practice.questionCards);
  const verdicts = new Map();
  const graded = history.filter((s) => Number.isFinite(s.gradedPercent) && s.practiceAssessment);
  for (const s of graded) for (const id of s.practiceAssessment.questionIds) {
    if (!questionIds.includes(id)) continue;
    const verdict = s.practiceQuestionVerdicts?.[id] ?? {
      correct: (s.voidedItemIds ?? []).includes(id) ? null : !(s.missedItemIds ?? []).includes(id),
      at: s.gradedAt ?? s.updatedAt,
    };
    const prior = verdicts.get(id);
    if (!prior || Date.parse(verdict.at) >= Date.parse(prior.at)) verdicts.set(id, { ...verdict, sessionId: s.sessionId });
  }
  const resolvedQuestionIds = questionIds.filter((id) => verdicts.get(id)?.correct === true);
  const unresolvedQuestionIds = questionIds.filter((id) => !resolvedQuestionIds.includes(id));
  const requirements = new Map();
  for (const id of unresolvedQuestionIds) {
    const miss = verdicts.get(id);
    if (!miss || miss.correct) continue;
    for (const cardId of practice.questionCards[id].cardIds) {
      const previous = requirements.get(cardId);
      if (!previous || Date.parse(miss.at) > Date.parse(previous.after)) requirements.set(cardId, { cardId, after: miss.at, sessionId: miss.sessionId });
    }
  }
  const evidence = dayFiles.flatMap((day) => Object.values(day.items ?? {}))
    .filter((item) => item.source === 'course-review' && item.courseUnitId === unit.unitId);
  const pendingReviewCardIds = [...requirements.values()].filter(({ cardId, after }) => {
    const attempts = evidence.filter((e) => e.wordId === cardId && Date.parse(e.at) > Date.parse(after)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const passed = new Set();
    for (const e of attempts) {
      if (e.result?.correct === false) passed.clear();
      else if (e.result?.correct === true) passed.add(e.task);
    }
    return !passed.has('3.1') || !passed.has('2.2');
  }).map((r) => r.cardId);
  const missingCardIds = practice.requiredCardIds.filter((id) => {
    const w = status.words?.[id];
    return !w || w.excluded === true || w.state !== 'mastered' || !(w.recognizedCount >= 1) || w.matched !== true;
  });
  const active = [...history].reverse().find((s) => !s.terminal && s.firstIssuedAt && s.gradedPercent == null);
  let stage = 'practice';
  if (resolvedQuestionIds.length === questionIds.length) stage = 'completed';
  else if (active) stage = 'quiz_issued';
  else if (requirements.size) stage = pendingReviewCardIds.length ? 'review' : 'retry_ready';
  else if (!missingCardIds.length) stage = 'quiz_ready';
  if (!readinessKnown && stage === 'practice') stage = 'unknown';
  return { unitId: unit.unitId, deckId: practice.deckId, stage, readinessKnown, totalQuestions: questionIds.length,
    resolvedQuestionIds, unresolvedQuestionIds, missingCardIds,
    reviewCardIds: [...requirements.keys()], pendingReviewCardIds, reviewRequirements: [...requirements.values()],
    feedback: unresolvedQuestionIds.filter((id) => verdicts.has(id)).map((questionId) => ({ questionId, ...practice.questionCards[questionId] })),
    activeSessionId: active?.sessionId ?? null, practice, assessmentForms: unit.assessmentForms,
  };
}

/** Prevent a passed short retry from hiding a subsequently corrected earlier answer. */
export function practiceAssessmentHistory(units, history) {
  const incomplete = new Set(units.filter((u) => u.practice && projectPracticeAssessment({ unit: u, sessions: history }).stage !== 'completed').map((u) => u.unitId));
  return history.map((s) => incomplete.has(s.unitId) && s.outcome?.result === 'passed' ? { ...s, outcome: { ...s.outcome, result: 'needs_remediation' } } : s);
}
