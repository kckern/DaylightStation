/**
 * The sole `ts-fsrs` import boundary. School code sees only its own progress
 * DTOs; package enums and raw card fields never escape this system adapter.
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, State } from 'ts-fsrs';

export const TS_FSRS_ENGINE = 'ts-fsrs@5.4.1/fsrs-6';
const RATINGS = Object.freeze({ again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy });
const STATES = Object.freeze({ [State.New]: 'new', [State.Learning]: 'learning', [State.Review]: 'review', [State.Relearning]: 'relearning' });
const asDate = (value, fallback) => {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback;
};

export class TsFsrsEngine {
  #scheduler(profile) {
    const parameters = profile?.parameters ?? {};
    // Fuzzing deliberately remains disabled: a saved School rating must replay
    // identically on another server and during a teacher repair.
    return fsrs(generatorParameters({
      request_retention: parameters.requestRetention,
      maximum_interval: parameters.maximumIntervalDays,
      enable_short_term: parameters.enableShortTerm,
      learning_steps: parameters.learningSteps,
      relearning_steps: parameters.relearningSteps,
      ...(Array.isArray(parameters.weights) ? { w: parameters.weights } : {}),
      enable_fuzz: false,
    }));
  }
  #card(progress, now) {
    const stored = progress?.scheduler?.engine === TS_FSRS_ENGINE ? progress.scheduler.card : null;
    if (!stored || typeof stored !== 'object') return createEmptyCard(asDate(progress?.dueAt, now));
    return {
      due: asDate(stored.due, now), stability: Number(stored.stability) || 0,
      difficulty: Number(stored.difficulty) || 0, elapsed_days: Number(stored.elapsed_days) || 0,
      scheduled_days: Number(stored.scheduled_days) || 0, reps: Number(stored.reps) || 0,
      lapses: Number(stored.lapses) || 0, learning_steps: Number(stored.learning_steps) || 0,
      state: Number.isInteger(stored.state) ? stored.state : State.New,
      ...(stored.last_review ? { last_review: asDate(stored.last_review, now) } : {}),
    };
  }
  #project(card, profile, now, startedAt = null) {
    return {
      state: STATES[card.state] ?? 'new', dueAt: asDate(card.due, now).toISOString(),
      reviews: card.reps, lapses: card.lapses, stabilityDays: card.stability,
      difficulty: card.difficulty,
      lastReviewedAt: card.last_review ? asDate(card.last_review, now).toISOString() : null,
      scheduler: {
        engine: TS_FSRS_ENGINE, profileId: profile.id, profileRevision: profile.revision,
        parameters: structuredClone(profile.parameters ?? {}), startedAt: startedAt ?? profile.startedAt ?? now.toISOString(),
        card: {
          due: asDate(card.due, now).toISOString(), stability: card.stability, difficulty: card.difficulty,
          elapsed_days: card.elapsed_days, scheduled_days: card.scheduled_days, reps: card.reps,
          lapses: card.lapses, learning_steps: card.learning_steps, state: card.state,
          ...(card.last_review ? { last_review: asDate(card.last_review, now).toISOString() } : {}),
        },
      },
    };
  }
  initial({ now = new Date(), profile }) { return this.#project(createEmptyCard(now), profile, now); }
  rate({ progress, rating, now = new Date(), profile }) {
    if (!Object.hasOwn(RATINGS, rating)) throw new TypeError('rating must be again|hard|good|easy');
    const result = this.#scheduler(profile).next(this.#card(progress, now), now, RATINGS[rating]);
    return { progress: this.#project(result.card, profile, now, progress?.scheduler?.startedAt), reviewLog: serializeLog(result.log) };
  }
  preview({ progress, now = new Date(), profile }) {
    const preview = this.#scheduler(profile).repeat(this.#card(progress, now), now);
    return Object.entries(RATINGS).map(([rating, value]) => {
      const card = preview[value].card;
      return { rating, dueAt: asDate(card.due, now).toISOString(), intervalDays: card.scheduled_days };
    });
  }
  retrievability({ progress, now = new Date(), profile }) {
    const card = this.#card(progress, now);
    if (card.state === State.New || !card.last_review) return null;
    return this.#scheduler(profile).get_retrievability(card, now, false);
  }
  forget({ progress, now = new Date(), profile, resetCount = false }) {
    const result = this.#scheduler(profile).forget(this.#card(progress, now), now, resetCount);
    return { progress: this.#project(result.card, profile, now, progress?.scheduler?.startedAt), reviewLog: serializeLog(result.log) };
  }
  rollback({ progress, reviewLog, now = new Date(), profile }) {
    const card = this.#scheduler(profile).rollback(this.#card(progress, now), hydrateLog(reviewLog, now));
    return this.#project(card, profile, now, progress?.scheduler?.startedAt);
  }
}

function serializeLog(log) {
  return {
    rating: log.rating, state: log.state, due: asDate(log.due, new Date()).toISOString(),
    stability: log.stability, difficulty: log.difficulty, elapsed_days: log.elapsed_days,
    last_elapsed_days: log.last_elapsed_days, scheduled_days: log.scheduled_days,
    learning_steps: log.learning_steps, review: asDate(log.review, new Date()).toISOString(),
  };
}
function hydrateLog(log, now) {
  if (!log || typeof log !== 'object') throw new TypeError('flashcard review log is unavailable');
  return { ...log, due: asDate(log.due, now), review: asDate(log.review, now) };
}
export default TsFsrsEngine;
