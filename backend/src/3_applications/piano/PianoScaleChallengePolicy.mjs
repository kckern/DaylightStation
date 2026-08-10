import { materializePianoScalePrompt } from '#shared/music/pianoScale.mjs';

const POLICY_VERSION = 'foundation-major-scales-v1';
const CURRICULUM = Object.freeze({
  'foundation-major-scales': Object.freeze([
    { tonic: 'C', octave: 4, mode: 'major', direction: 'ascending', octaves: 1 },
    { tonic: 'G', octave: 4, mode: 'major', direction: 'ascending', octaves: 1 },
    { tonic: 'F', octave: 4, mode: 'major', direction: 'ascending', octaves: 1 },
    { tonic: 'D', octave: 4, mode: 'major', direction: 'ascending', octaves: 1 },
  ]),
});

function candidateStats(candidate, attempts) {
  const relevant = attempts.filter((attempt) => (
    attempt?.status === 'completed'
    && attempt?.prompt?.scale?.tonic === candidate.tonic
    && attempt?.prompt?.scale?.mode === candidate.mode
    && Number.isFinite(attempt.score)
  ));
  const average = relevant.length > 0
    ? relevant.reduce((total, attempt) => total + attempt.score, 0) / relevant.length
    : null;
  return { candidate, attempts: relevant.length, average };
}

/**
 * Fixed-band pilot policy. Concrete exercise choice belongs to Piano, not the
 * game reducer. It explores unattempted scales first, then revisits the weakest
 * observed scale; sequence is used only as a deterministic tie-breaker.
 */
export class PianoScaleChallengePolicy {
  constructor({ attemptStore = null, maxMistakes = 3, timeoutMs = 90_000 } = {}) {
    this.attemptStore = attemptStore;
    this.maxMistakes = maxMistakes;
    this.timeoutMs = timeoutMs;
  }

  prepare({ userId, challengeId, kind, requirements = {}, context = {} }) {
    if (kind !== 'scale') throw new Error(`Unsupported piano challenge kind: ${kind}`);
    const curriculumId = requirements.curriculum || 'foundation-major-scales';
    const curriculum = CURRICULUM[curriculumId];
    if (!curriculum) throw new Error(`Unknown piano curriculum: ${curriculumId}`);
    const recent = this.attemptStore?.listRecent?.(userId, { limit: 100 }) || [];
    const stats = curriculum.map((candidate) => candidateStats(candidate, recent));
    const minimumAttempts = Math.min(...stats.map((entry) => entry.attempts));
    let eligible = stats.filter((entry) => entry.attempts === minimumAttempts);
    if (minimumAttempts > 0) {
      const weakest = Math.min(...eligible.map((entry) => entry.average ?? 1));
      eligible = eligible.filter((entry) => (entry.average ?? 1) === weakest);
    }
    const sequence = Number.isInteger(context.challenge_sequence) ? context.challenge_sequence : 0;
    const selected = eligible[((sequence % eligible.length) + eligible.length) % eligible.length];
    const prompt = materializePianoScalePrompt({
      scale: structuredClone(selected.candidate),
      max_mistakes: this.maxMistakes,
    });
    return {
      challenge_id: challengeId,
      kind,
      prompt,
      timeout_ms: this.timeoutMs,
      pedagogy_policy_version: POLICY_VERSION,
      selection: {
        curriculum: curriculumId,
        prior_attempts: selected.attempts,
        prior_average: selected.average,
      },
    };
  }
}

export default PianoScaleChallengePolicy;
