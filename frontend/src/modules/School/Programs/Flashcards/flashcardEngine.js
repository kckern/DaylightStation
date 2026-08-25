export const MODES = Object.freeze(['review', 'learn', 'cards', 'test']);
export const RATINGS = Object.freeze(['again', 'hard', 'good', 'easy']);

export function resolvePolicy(policy = {}) {
  return {
    modes: (policy.modes || MODES).filter((mode) => MODES.includes(mode)),
    activeMinutes: Math.max(0, Number(policy.activeMinutes) || 0),
    minimumReviews: Math.max(0, Number(policy.minimumReviews) || 0),
    masteryPercent: policy.masteryPercent == null ? null : Math.min(100, Math.max(0, Number(policy.masteryPercent))),
    newCardLimit: Math.max(1, Number(policy.newCardLimit) || 20),
  };
}

export function assignmentSatisfied({ policy, progress = {} }) {
  const resolved = resolvePolicy(policy);
  const minutes = (Number(progress.activeSeconds) || 0) / 60;
  const reviews = Number(progress.reviews) || 0;
  const mastery = Number(progress.masteryPercent) || 0;
  return minutes >= resolved.activeMinutes && reviews >= resolved.minimumReviews
    && (resolved.masteryPercent == null || mastery >= resolved.masteryPercent)
    && (progress.quizRequired !== true || progress.quizPassed === true);
}

export function cardFace(card, direction = 'front_to_back', revealed = false) {
  const first = direction === 'back_to_front' ? 'back' : 'front';
  const second = first === 'front' ? 'back' : 'front';
  return revealed ? card?.[second] : card?.[first];
}

export function learnPrompt(card, bankItem = null) {
  if (bankItem?.choices?.length > 1) return { kind: 'choice', prompt: bankItem.prompt, choices: bankItem.choices, answer: bankItem.answer };
  return { kind: 'reveal', prompt: card?.front?.blocks?.find((block) => block.type === 'text')?.text || '', answer: card?.back?.blocks?.find((block) => block.type === 'text')?.text || '' };
}
