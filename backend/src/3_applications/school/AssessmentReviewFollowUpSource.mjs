import { deriveAssessmentReviewFollowUps } from '#domains/school/progress/index.mjs';

/** Default subject-neutral follow-up provider for below-threshold assessments. */
export class AssessmentReviewFollowUpSource {
  #thresholdPercent; #maxPerLearner;

  constructor({ thresholdPercent = 80, maxPerLearner = 1 } = {}) {
    this.#thresholdPercent = thresholdPercent;
    this.#maxPerLearner = maxPerLearner;
  }

  listFollowUps({ evidence }) {
    return deriveAssessmentReviewFollowUps(evidence, {
      thresholdPercent: this.#thresholdPercent,
      maxPerLearner: this.#maxPerLearner,
    });
  }
}

export default AssessmentReviewFollowUpSource;
