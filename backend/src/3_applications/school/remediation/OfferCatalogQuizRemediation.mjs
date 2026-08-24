import { ValidationError } from '#domains/core/errors/index.mjs';
import { bankContentRev } from '#domains/school/bankRev.mjs';

/** Mint an adaptive-tutor offer from a completed, server-resolved Catalog quiz. */
export class OfferCatalogQuizRemediation {
  #catalog; #grader; #offers;

  constructor({ catalog, grader, remediationOffers } = {}) {
    if (!catalog || typeof catalog.lesson !== 'function'
        || !grader || typeof grader.completedQuizAssessment !== 'function'
        || !remediationOffers || typeof remediationOffers.execute !== 'function') {
      throw new Error('OfferCatalogQuizRemediation requires catalog, grader, and remediationOffers');
    }
    this.#catalog = catalog;
    this.#grader = grader;
    this.#offers = remediationOffers;
  }

  async execute({ sessionId, learnerId } = {}) {
    const assessment = this.#grader.completedQuizAssessment({ sessionId, learnerId });
    const address = assessment.learning;
    const bundle = await this.#catalog.lesson({
      learnerId,
      catalogId: address.catalogId,
      subjectId: address.subjectId,
      courseId: address.courseId,
      unitId: address.unitId,
      lessonId: address.lessonId,
    });
    const module = bundle?.lesson?.modules?.find((candidate) => candidate.moduleId === address.moduleId);
    if (!module || module.type !== 'quiz') {
      throw new ValidationError(`Catalog quiz module is no longer available: ${address.moduleId}`);
    }
    if (module.bank?.id !== assessment.bank.id
        || bankContentRev(module.bank) !== assessment.bankRev) {
      throw new ValidationError('Catalog quiz changed after this session; reopen it before tutoring');
    }
    return this.#offers.execute({
      learnerId,
      source: {
        kind: 'assessment', surface: 'web', externalId: assessment.sessionId,
        recordDigest: assessment.bankRev,
        artifactId: assessment.bank.id,
        lessonId: address.lessonId,
        moduleId: address.moduleId,
      },
      lesson: bundle.lesson,
      module,
      bank: assessment.bank,
      responses: assessment.responses,
    });
  }
}

export default OfferCatalogQuizRemediation;
