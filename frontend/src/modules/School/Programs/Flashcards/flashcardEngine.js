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

export function learnPrompt(card, direction = 'front_to_back') {
  const source = direction === 'back_to_front' ? card?.back : card?.front;
  const target = direction === 'back_to_front' ? card?.front : card?.back;
  const derived = faceText(target);
  const aliases = card?.learn?.[direction]?.acceptedAnswers ?? [];
  const acceptedAnswers = aliases.length ? aliases : derived ? [derived] : [];
  return { kind: acceptedAnswers.length ? 'recall' : 'reveal', prompt: faceText(source), acceptedAnswers };
}

function faceText(face) {
  const block = face?.blocks?.find((candidate) => ['text', 'tts'].includes(candidate.type)
    || (candidate.type === 'image' && candidate.alt) || (['audio', 'video'].includes(candidate.type) && candidate.transcript));
  return block?.text ?? block?.alt ?? block?.transcript ?? '';
}

/** Tolerant typed-recall match: formatting never masks a known answer. */
export function recallMatches(given, expected) {
  const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
  return normalize(given) !== '' && normalize(given) === normalize(expected);
}

export function recallMatchesAny(given, expected = []) {
  return expected.some((answer) => recallMatches(given, answer));
}
