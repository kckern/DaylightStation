/**
 * Version-pinned FSRS-6 scheduling boundary. `enable_fuzz: false` is
 * intentional: a learner's saved rating produces the same result on every
 * server, which keeps support, test replay, and recovery deterministic.
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, State } from 'ts-fsrs';

export const FLASHCARD_SCHEDULER = 'ts-fsrs@5.4.1/fsrs-6';
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));
const RATING = Object.freeze({ again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy });
const STATE = Object.freeze({
  [State.New]: 'new', [State.Learning]: 'learning', [State.Review]: 'review', [State.Relearning]: 'relearning',
});

const date = (value, fallback) => {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback;
};

function project(card) {
  return {
    state: STATE[card.state] ?? 'new',
    dueAt: date(card.due, new Date()).toISOString(),
    reviews: card.reps,
    lapses: card.lapses,
    stabilityDays: card.stability,
    difficulty: card.difficulty,
    lastReviewedAt: card.last_review ? date(card.last_review, new Date()).toISOString() : null,
    scheduler: {
      algorithm: FLASHCARD_SCHEDULER, parametersVersion: 'fsrs-6-default-1',
      card: {
        due: date(card.due, new Date()).toISOString(), stability: card.stability,
        difficulty: card.difficulty, elapsed_days: card.elapsed_days,
        scheduled_days: card.scheduled_days, reps: card.reps, lapses: card.lapses,
        learning_steps: card.learning_steps, state: card.state,
        ...(card.last_review ? { last_review: date(card.last_review, new Date()).toISOString() } : {}),
      },
    },
  };
}

function cardFor(progress, now) {
  const stored = progress?.scheduler?.algorithm === FLASHCARD_SCHEDULER ? progress.scheduler.card : null;
  if (!stored || typeof stored !== 'object') {
    // Bootstrap cards were projections, not FSRS cards. Preserve no fabricated
    // stability; place them back in FSRS's first-review path at their prior
    // due date. Their old history stays in the durable event/progress record.
    return createEmptyCard(date(progress?.dueAt, now));
  }
  return {
    due: date(stored.due, now), stability: Number(stored.stability) || 0,
    difficulty: Number(stored.difficulty) || 0, elapsed_days: Number(stored.elapsed_days) || 0,
    scheduled_days: Number(stored.scheduled_days) || 0, reps: Number(stored.reps) || 0,
    lapses: Number(stored.lapses) || 0, learning_steps: Number(stored.learning_steps) || 0,
    state: Number.isInteger(stored.state) ? stored.state : State.New,
    ...(stored.last_review ? { last_review: date(stored.last_review, now) } : {}),
  };
}

export function initialCardProgress({ now = new Date() } = {}) { return project(createEmptyCard(now)); }

export function scheduleReview(progress, rating, { now = new Date() } = {}) {
  if (!Object.hasOwn(RATING, rating)) throw new TypeError('rating must be again|hard|good|easy');
  const prior = cardFor(progress, now);
  const { card } = scheduler.next(prior, now, RATING[rating]);
  return project(card);
}

export function selectReviewCards(deck, progressByCard = {}, { now = new Date(), newLimit = 20, limit = 20 } = {}) {
  const due = []; const fresh = [];
  for (const card of deck?.cards || []) {
    const progress = progressByCard[card.cardId] || initialCardProgress({ now });
    if (progress.state === 'suspended') continue;
    if (progress.state === 'new') fresh.push(card);
    else if (date(progress.dueAt, now).getTime() <= now.getTime()) due.push(card);
  }
  due.sort((a, b) => date(progressByCard[a.cardId]?.dueAt, now) - date(progressByCard[b.cardId]?.dueAt, now));
  return [...due, ...fresh.slice(0, newLimit)].slice(0, limit);
}
