/**
 * Scheduler adapter boundary. The stored state deliberately includes an
 * algorithm/version so a vetted FSRS implementation can replace this
 * conservative bootstrap policy without rewriting learner history.
 */
export const FLASHCARD_SCHEDULER = 'fsrs-bootstrap-1';
const HOUR = 60 * 60 * 1000;
const DAY = HOUR * 24;
const RATING_FACTORS = Object.freeze({ again: 0.25, hard: 0.8, good: 1.7, easy: 2.5 });

export function initialCardProgress({ now = new Date() } = {}) {
  return { state: 'new', dueAt: now.toISOString(), reviews: 0, lapses: 0, stabilityDays: 0, difficulty: 5, scheduler: { algorithm: FLASHCARD_SCHEDULER, parametersVersion: 'default-1' } };
}

export function scheduleReview(progress, rating, { now = new Date() } = {}) {
  if (!Object.hasOwn(RATING_FACTORS, rating)) throw new TypeError('rating must be again|hard|good|easy');
  const current = { ...initialCardProgress({ now }), ...(progress || {}) };
  const priorDays = Number(current.stabilityDays) || 0;
  const forgotten = rating === 'again';
  const stabilityDays = forgotten ? 0 : Math.max(1, priorDays || 1) * RATING_FACTORS[rating];
  const delay = forgotten ? 10 * 60 * 1000 : Math.max(DAY, Math.round(stabilityDays * DAY));
  const difficulty = Math.min(10, Math.max(1, (Number(current.difficulty) || 5) + (forgotten ? 1 : rating === 'easy' ? -0.35 : rating === 'good' ? -0.1 : 0.2)));
  return {
    ...current,
    state: forgotten ? 'learning' : stabilityDays >= 21 ? 'review' : 'learning',
    dueAt: new Date(now.getTime() + delay).toISOString(),
    stabilityDays: Number(stabilityDays.toFixed(3)), difficulty: Number(difficulty.toFixed(3)),
    reviews: (Number(current.reviews) || 0) + 1,
    lapses: (Number(current.lapses) || 0) + (forgotten ? 1 : 0),
    lastReviewedAt: now.toISOString(),
    scheduler: { algorithm: FLASHCARD_SCHEDULER, parametersVersion: 'default-1' },
  };
}

export function selectReviewCards(deck, progressByCard = {}, { now = new Date(), newLimit = 20, limit = 20 } = {}) {
  const due = []; const fresh = [];
  for (const card of deck?.cards || []) {
    const progress = progressByCard[card.cardId] || initialCardProgress({ now });
    if (progress.state === 'suspended') continue;
    if (progress.state === 'new') fresh.push(card);
    else if (Date.parse(progress.dueAt) <= now.getTime()) due.push(card);
  }
  due.sort((a, b) => Date.parse(progressByCard[a.cardId]?.dueAt || 0) - Date.parse(progressByCard[b.cardId]?.dueAt || 0));
  return [...due, ...fresh.slice(0, newLimit)].slice(0, limit);
}
