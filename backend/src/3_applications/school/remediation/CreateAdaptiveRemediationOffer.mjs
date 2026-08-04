import {
  adaptiveRemediationSessionView,
  createAdaptiveRemediationSession,
  evaluateAssessmentForRemediation,
  validateAdaptiveRemediationPolicy,
} from '#domains/school/remediation/index.mjs';

/** Create (or retrieve) a durable offer from authoritative assessment evidence. */
export class CreateAdaptiveRemediationOffer {
  #sessions; #sessionIdFactory; #clock;

  constructor({ sessions, sessionIdFactory, clock = () => new Date() } = {}) {
    if (!sessions || typeof sessions.createOffer !== 'function'
        || typeof sessionIdFactory !== 'function') {
      throw new Error('CreateAdaptiveRemediationOffer requires sessions and sessionIdFactory');
    }
    this.#sessions = sessions;
    this.#sessionIdFactory = sessionIdFactory;
    this.#clock = clock;
  }

  async execute({ learnerId, source, lesson, module, bank, responses } = {}) {
    if (!module?.remediation || module.remediation.enabled === false) {
      return { status: 'not_configured', offer: null };
    }
    const validated = validateAdaptiveRemediationPolicy(module.remediation, {
      path: `module '${module.moduleId ?? 'unknown'}'.remediation`,
    });
    if (validated.errors.length) {
      throw new Error(`Adaptive remediation policy is invalid: ${validated.errors.join('; ')}`);
    }
    const evaluated = evaluateAssessmentForRemediation({
      policy: validated.policy, bank, responses,
    });
    if (evaluated.errors.length) {
      throw new Error(`Adaptive remediation evidence is invalid: ${evaluated.errors.join('; ')}`);
    }
    if (!evaluated.evaluation.triggered) {
      return {
        status: 'not_triggered', offer: null,
        assessment: assessmentView(evaluated.evaluation),
      };
    }
    const createdAt = readClock(this.#clock);
    const sessionId = this.#sessionIdFactory({ learnerId, source });
    const weak = new Set(evaluated.evaluation.concepts.map(({ conceptId }) => conceptId));
    const session = createAdaptiveRemediationSession({
      sessionId,
      learnerId,
      source: structuredClone(source),
      tutorContext: {
        lesson: {
          lessonId: lesson?.lessonId ?? source.lessonId ?? null,
          title: lesson?.title ?? null,
          objectives: structuredClone(lesson?.objectives ?? []),
        },
        module: { moduleId: module.moduleId, title: module.title ?? null },
        bank: {
          id: bank.id,
          title: bank.title,
          concepts: structuredClone(bank.concepts.filter(({ conceptId }) => weak.has(conceptId))),
          items: structuredClone(bank.items.filter((item) => item.concepts?.some((id) => weak.has(id)))),
        },
      },
      policy: validated.policy,
      evaluation: evaluated.evaluation,
      createdAt,
    });
    const stored = await this.#sessions.createOffer(session);
    return {
      status: stored.status === 'created' ? 'offered' : 'already_offered',
      offer: adaptiveRemediationSessionView(stored.session),
      assessment: assessmentView(evaluated.evaluation),
    };
  }
}

function assessmentView(evaluation) {
  return Object.freeze({
    correct: evaluation.correct,
    incorrect: evaluation.incorrect,
    total: evaluation.total,
    scorePercent: evaluation.scorePercent,
    weakConceptIds: Object.freeze(evaluation.concepts.map(({ conceptId }) => conceptId)),
  });
}

function readClock(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new Error('Adaptive remediation clock must return a valid Date');
  }
  return value.toISOString();
}

export default CreateAdaptiveRemediationOffer;
