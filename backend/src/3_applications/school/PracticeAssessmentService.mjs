import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { projectPracticeAssessment, practiceAssessmentHistory } from '#domains/school/practiceAssessment.mjs';
import { planLearnerWork } from '#domains/school/planner.mjs';
import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { withAttestedPasses } from './PlanProjection.mjs';
import { withCurriculumExceptions, pausedExceptionFor } from './curriculumExceptionProjection.mjs';
import { isCardLadderPolicy } from '#domains/school/flashcards/index.mjs';

/** Coordinates course feedback; progress is derived from durable paper and card evidence. */
export class PracticeAssessmentService {
  #curriculum; #assignments; #sessions; #cards; #clock; #issuer = null; #remediation = null; #newSessionId; #printing = new Map(); #documents = null; #attestations; #exceptions;
  constructor({ curriculum, assignments, sessions, cardLadder, clock = () => new Date(), newSessionId = null, attestations = null, curriculumExceptions = null }) {
    this.#attestations = attestations; this.#exceptions = curriculumExceptions;
    this.#curriculum = curriculum; this.#assignments = assignments; this.#sessions = sessions; this.#cards = cardLadder; this.#clock = clock; this.#newSessionId = newSessionId;
  }
  configurePrinting({ issueDocument, openRemediation, printDocuments = null }) { this.#issuer = issueDocument; this.#remediation = openRemediation; this.#documents = printDocuments; }
  async #context({ learnerId, unitId }) {
    const [unit, assignment, rows, units] = await Promise.all([this.#curriculum.getUnit(unitId), this.#assignments.get(learnerId), this.#sessions.listForLearner(learnerId), this.#curriculum.listUnits()]);
    if (!unit?.practice || unit.unitId !== unitId) throw new EntityNotFoundError('practice assessment', unitId);
    const assigned = assignment?.units?.some((u) => (typeof u === 'string' ? u : u.unitId) === unitId)
      || assignment?.courses?.some((c) => (typeof c === 'string' ? c : c.courseId) === unit.courseId);
    const enrollment = assignment?.programs?.find((p) => p.programId === 'flashcards' && p.linkedUnitId === unitId && (p.deckId ?? p.corpusId) === unit.practice.deckId && isCardLadderPolicy(p.policy));
    if (!assigned || !enrollment) throw new GuestForbiddenError('This practice assessment is not assigned to this learner.');
    const history = await Promise.all(rows.map(async (row) => {
      if (!units.some((u) => u.unitId === row.unitId && u.practice)) return row;
      const state = reduceSession(await this.#sessions.readEvents(row.sessionId));
      return { ...state, updatedAt: row.updatedAt };
    }));
    const evidence = await this.#cards.courseEvidence({ userId: learnerId, deckId: unit.practice.deckId });
    const progress = projectPracticeAssessment({ unit, ...evidence, sessions: history.filter((s) => s.learnerId === learnerId) });
    const exceptions = await this.#exceptions?.active?.() ?? [];
    const planningHistory = withCurriculumExceptions(withAttestedPasses(practiceAssessmentHistory(units, history), this.#attestations, learnerId), exceptions, learnerId);
    const plan = planLearnerWork({ learnerId, assignment, units, sessions: planningHistory, now: this.#clock().toISOString() });
    const entry = plan.entries.find((e) => e.unitId === unitId);
    const paused = pausedExceptionFor(exceptions, unitId);
    if (paused || !entry || ['locked', 'dormant', 'upcoming'].includes(entry.status)) {
      progress.stage = 'locked'; progress.message = paused ? `This lesson is paused: ${paused.reason}` : entry?.reason ?? 'Finish the preceding lesson first.';
    }
    return { unit, history, progress };
  }
  async forDeck({ learnerId, deckId }) {
    const assignment = await this.#assignments.get(learnerId);
    const enrollment = assignment?.programs?.find((p) => p.programId === 'flashcards' && (p.deckId ?? p.corpusId) === deckId && p.linkedUnitId);
    return enrollment ? this.get({ learnerId, unitId: enrollment.linkedUnitId }) : null;
  }
  async get(args) { return (await this.#context(args)).progress; }
  async prepare({ state, unit }) {
    const { progress } = await this.#context({ learnerId: state.learnerId, unitId: state.unitId });
    if (!['quiz_ready', 'retry_ready'].includes(progress.stage)) throw new ValidationError(`Complete the ${progress.stage === 'review' ? 'focused review' : 'card practice'} before printing this quiz.`);
    if (state.practiceAssessment && JSON.stringify(state.practiceAssessment.questionIds) === JSON.stringify(progress.unresolvedQuestionIds)) return state.practiceAssessment;
    if (this.#documents) {
      const expected = Object.keys(progress.practice.questionCards).sort();
      const questions = (blocks) => (blocks ?? []).flatMap((block) => block.type === 'question' ? [block.itemId] : questions(block.blocks));
      for (const ref of progress.assessmentForms) {
        const [id, rev] = ref.slice(6).split('@');
        const document = await this.#documents.getPublished(id, rev);
        if (!document || JSON.stringify(questions(document.blocks).sort()) !== JSON.stringify(expected)) throw new ValidationError(`Assessment form ${ref} has a different question roster.`);
      }
    }
    const snapshot = { practice: progress.practice, assessmentForms: progress.assessmentForms,
      document: progress.assessmentForms[state.variant % progress.assessmentForms.length],
      questionIds: progress.unresolvedQuestionIds, readyAt: this.#clock().toISOString(),
    };
    const built = createEvent({ type: 'practice_prepared', sessionId: state.sessionId, at: snapshot.readyAt, assessment: snapshot });
    if (built.errors.length) throw new ValidationError(built.errors.join('; '));
    await this.#sessions.appendEvent(state.sessionId, built.event);
    return snapshot;
  }
  async recordFeedback({ state }) {
    const practice = state.practiceAssessment?.practice;
    if (!practice || !state.gradedAt) return;
    const cardIds = [...new Set((state.missedItemIds ?? []).flatMap((id) => {
      const link = practice.questionCards[id];
      return link?.kind === 'vocabulary' ? link.cardIds : [];
    }))];
    if (cardIds.length) await this.#cards.coursePaperFeedback({ userId: state.learnerId, deckId: practice.deckId, cardIds, attemptKey: `${state.sessionId}:${state.gradedAt}` });
  }
  async review({ learnerId, unitId, sittingId }) {
    const progress = await this.get({ learnerId, unitId });
    if (progress.stage !== 'review') throw new ValidationError('There are no outstanding course review cards.');
    return this.#cards.courseReview({ userId: learnerId, deckId: progress.deckId, sittingId, unitId, chosen: progress.pendingReviewCardIds,
      after: progress.reviewRequirements.map((r) => r.after).sort().at(-1) });
  }
  async print(args) {
    const key = `${args.learnerId}|${args.unitId}`;
    if (this.#printing.has(key)) return this.#printing.get(key);
    const promise = this.#print(args).finally(() => this.#printing.delete(key));
    this.#printing.set(key, promise); return promise;
  }
  async #print(args) {
    if (!this.#issuer || !this.#newSessionId) throw new ValidationError('Course printing is not configured.');
    const { history, progress } = await this.#context(args);
    if (!['quiz_ready', 'retry_ready', 'quiz_issued'].includes(progress.stage)) throw new ValidationError('Finish the card practice or focused review before printing.');
    const own = history.filter((s) => s.unitId === args.unitId);
    let sessionId = progress.activeSessionId ?? [...own].reverse().find((s) => s.state === 'created' && !s.terminal)?.sessionId;
    if (!sessionId && progress.stage === 'retry_ready') {
      const parents = own.filter((s) => s.outcome && s.practiceAssessment && !s.evidenceInvalidated);
      const parent = parents.sort((a, b) => Date.parse(a.firstIssuedAt) - Date.parse(b.firstIssuedAt)).at(-1);
      if (!parent) throw new ValidationError('The graded quiz result is still being settled.');
      if (parent.outcome.result === 'needs_remediation' && !parent.remediation && parent.state === 'outcome_recorded') {
        const opened = await this.#remediation.execute({ sessionId: parent.sessionId });
        sessionId = opened.newSessionId;
        if (!sessionId) throw new ValidationError(opened.message);
      } else {
        // A teacher correction can reopen cumulative questions after the old
        // retry chain finished. Preserve that chain and its reward history;
        // the new child's remediationOf is the durable recovery link.
        sessionId = this.#newSessionId();
        const built = createEvent({ type: 'created', at: this.#clock().toISOString(), sessionId,
          learnerId: args.learnerId, unitId: args.unitId, remediationOf: parent.sessionId,
          variant: (parent.variant + 1) % progress.assessmentForms.length, remediationItemIds: progress.unresolvedQuestionIds });
        if (built.errors.length) throw new ValidationError(built.errors.join('; '));
        await this.#sessions.appendEvent(sessionId, built.event);
      }
    }
    if (!sessionId) {
      sessionId = this.#newSessionId();
      const built = createEvent({ type: 'created', at: this.#clock().toISOString(), sessionId, learnerId: args.learnerId, unitId: args.unitId, variant: 0 });
      if (built.errors.length) throw new ValidationError(built.errors.join('; '));
      await this.#sessions.appendEvent(sessionId, built.event);
    }
    return this.#issuer.execute({ sessionId });
  }
}
