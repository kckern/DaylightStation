import { materializePianoScalePrompt } from '#shared/music/pianoScale.mjs';

const LEGACY_POLICY_VERSION = 'foundation-major-scales-v1';
const JOURNEY_POLICY_VERSION = 'adaptive-piano-journey-v1';
const PITCH_CLASS = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });

const LEGACY_SCALES = Object.freeze([
  { id: 'scale-c-major', tonic: 'C', octave: 4, mode: 'major', direction: 'ascending', octaves: 1 },
  { id: 'scale-g-major', tonic: 'G', octave: 4, mode: 'major', direction: 'ascending', octaves: 1 },
  { id: 'scale-f-major', tonic: 'F', octave: 4, mode: 'major', direction: 'ascending', octaves: 1 },
  { id: 'scale-d-major', tonic: 'D', octave: 4, mode: 'major', direction: 'ascending', octaves: 1 },
]);

const JOURNEY_CURRICULUM = Object.freeze({
  scale: LEGACY_SCALES,
  chord: Object.freeze([
    { id: 'chord-c-major', tonic: 'C', quality: 'major', midi: [60, 64, 67] },
    { id: 'chord-c-minor', tonic: 'C', quality: 'minor', midi: [60, 63, 67] },
    { id: 'chord-f-major', tonic: 'F', quality: 'major', midi: [65, 69, 72] },
    { id: 'chord-f-minor', tonic: 'F', quality: 'minor', midi: [65, 68, 72] },
    { id: 'chord-g-major', tonic: 'G', quality: 'major', midi: [67, 71, 74] },
    { id: 'chord-g-minor', tonic: 'G', quality: 'minor', midi: [67, 70, 74] },
  ]),
  arpeggio: Object.freeze([
    { id: 'arpeggio-c-major', tonic: 'C', quality: 'major', midi: [60, 64, 67, 72] },
    { id: 'arpeggio-g-major', tonic: 'G', quality: 'major', midi: [55, 59, 62, 67] },
    { id: 'arpeggio-f-major', tonic: 'F', quality: 'major', midi: [53, 57, 60, 65] },
  ]),
  'timed-pattern': Object.freeze([
    { id: 'pattern-c-step', label: 'C step pattern', midi: [60, 62, 64, 65], beat_offsets: [0, 1, 2, 3] },
    { id: 'pattern-g-turn', label: 'G turn pattern', midi: [67, 69, 71, 69, 67], beat_offsets: [0, 1, 2, 3, 4] },
    { id: 'pattern-f-skip', label: 'F skip pattern', midi: [65, 69, 67, 70, 69, 72], beat_offsets: [0, 1, 2, 3, 4, 5] },
  ]),
});

function attemptKind(attempt) {
  if (attempt?.kind) return attempt.kind;
  if (attempt?.prompt?.scale) return 'scale';
  return null;
}

function attemptMatches(attempt, candidate, kind) {
  if (attemptKind(attempt) !== kind || attempt.status !== 'completed' || !Number.isFinite(attempt.score)) return false;
  if (attempt.prompt?.exercise_id) return attempt.prompt.exercise_id === candidate.id;
  return kind === 'scale'
    && attempt.prompt?.scale?.tonic === candidate.tonic
    && attempt.prompt?.scale?.mode === candidate.mode;
}

function candidateStats(candidate, kind, attempts) {
  const relevant = attempts.filter((attempt) => attemptMatches(attempt, candidate, kind));
  const average = relevant.length > 0
    ? relevant.reduce((total, attempt) => total + attempt.score, 0) / relevant.length
    : null;
  return { candidate, attempts: relevant.length, average };
}

function adaptiveTempo(kind, attempts) {
  const completed = attempts.filter((attempt) => attemptKind(attempt) === kind && attempt.status === 'completed' && Number.isFinite(attempt.score));
  if (completed.filter((attempt) => attempt.score >= 0.85).length < 2) return null;
  const paced = completed.filter((attempt) => Number.isFinite(attempt.prompt?.tempo_bpm));
  const previousTempo = paced[0]?.prompt?.tempo_bpm || 60;
  if (paced.length < 2) return previousTempo;
  const recentAverage = (paced[0].score + paced[1].score) / 2;
  if (recentAverage > 0.9) return Math.min(120, previousTempo + 5);
  if (recentAverage < 0.7) return Math.max(40, previousTempo - 5);
  return previousTempo;
}

function materialize(candidate, kind, tempoBpm, maxMistakes = null) {
  if (kind === 'scale') {
    const { id, ...scale } = candidate;
    return materializePianoScalePrompt({
      exercise_id: id,
      scale,
      ...(maxMistakes ? { max_mistakes: maxMistakes } : {}),
      ...(tempoBpm ? { tempo_bpm: tempoBpm, lead_in_ms: 2_000 } : {}),
    });
  }
  if (kind === 'chord') {
    const expectedEvents = [{
      id: `${candidate.id}:event:0`, onsetQuarter: 0, durationQuarters: 1,
      notes: candidate.midi.map((midi, index) => ({ id: `${candidate.id}:note:${index}`, midi, hand: 'unassigned' })),
    }];
    return {
      exercise_id: candidate.id,
      label: `${candidate.tonic} ${candidate.quality} chord`,
      root: PITCH_CLASS[candidate.tonic],
      pitch_classes: candidate.midi.map((midi) => midi % 12),
      expected_midi: structuredClone(candidate.midi),
      expected_events: expectedEvents,
      ordering: 'any',
      chord: { tonic: candidate.tonic, quality: candidate.quality, inversion: 0 },
    };
  }
  const prompt = {
    exercise_id: candidate.id,
    label: candidate.label || `${candidate.tonic} ${candidate.quality} arpeggio`,
    expected_midi: structuredClone(candidate.midi),
    expected_events: candidate.midi.map((midi, index) => ({
      id: `${candidate.id}:event:${index}`,
      onsetQuarter: candidate.beat_offsets?.[index] ?? index,
      durationQuarters: candidate.beat_offsets?.[index + 1] != null
        ? candidate.beat_offsets[index + 1] - candidate.beat_offsets[index]
        : 1,
      notes: [{ id: `${candidate.id}:note:${index}`, midi, hand: 'unassigned' }],
    })),
    ordering: 'strict',
    key_signature: candidate.tonic || 'C',
    ...(tempoBpm ? { tempo_bpm: tempoBpm, lead_in_ms: 2_000 } : {}),
  };
  if (candidate.beat_offsets) {
    prompt.beat_offsets = structuredClone(candidate.beat_offsets);
    if (tempoBpm) prompt.target_offsets_ms = candidate.beat_offsets.map((beat) => beat * 60_000 / tempoBpm);
  }
  return prompt;
}

/**
 * Piano-owned adaptive policy for game challenges. It explores unattempted
 * exercises first, then revisits the weakest exercise in that skill family.
 * Pacing appears only after two strong untimed performances and changes in
 * five-BPM steps to keep recent accuracy in a productive 0.70–0.90 band.
 */
export class PianoScaleChallengePolicy {
  constructor({ attemptStore = null, maxMistakes = 3, timeoutMs = 90_000 } = {}) {
    this.attemptStore = attemptStore;
    this.maxMistakes = maxMistakes;
    this.timeoutMs = timeoutMs;
  }

  prepare({ userId, challengeId, kind, requirements = {}, context = {} }) {
    const curriculumId = requirements?.curriculum || 'foundation-major-scales';
    const legacy = curriculumId === 'foundation-major-scales';
    if (legacy && kind !== 'scale') throw new Error(`Unsupported piano challenge kind: ${kind}`);
    if (!legacy && curriculumId !== 'pokemon-journey-foundations') throw new Error(`Unknown piano curriculum: ${curriculumId}`);
    const curriculum = legacy ? LEGACY_SCALES : JOURNEY_CURRICULUM[kind];
    if (!curriculum) throw new Error(`Unsupported piano challenge kind: ${kind}`);
    const recent = this.attemptStore?.listRecent?.(userId, { limit: 200 }) || [];
    const stats = curriculum.map((candidate) => candidateStats(candidate, kind, recent));
    const minimumAttempts = Math.min(...stats.map((entry) => entry.attempts));
    let eligible = stats.filter((entry) => entry.attempts === minimumAttempts);
    if (minimumAttempts > 0) {
      const weakest = Math.min(...eligible.map((entry) => entry.average ?? 1));
      eligible = eligible.filter((entry) => (entry.average ?? 1) === weakest);
    }
    const sequence = Number.isInteger(context?.challenge_sequence) ? context.challenge_sequence : 0;
    const selected = eligible[((sequence % eligible.length) + eligible.length) % eligible.length];
    const tempoBpm = legacy ? null : adaptiveTempo(kind, recent);
    const prompt = materialize(selected.candidate, kind, tempoBpm, legacy ? this.maxMistakes : null);
    const mode = tempoBpm ? 'cued' : 'free';
    return {
      challenge_id: challengeId,
      kind,
      assessment: {
        mode,
        tempo_bpm: tempoBpm,
        lead_in_ms: tempoBpm ? 2_000 : 0,
      },
      prompt,
      timeout_ms: this.timeoutMs,
      pedagogy_policy_version: legacy ? LEGACY_POLICY_VERSION : JOURNEY_POLICY_VERSION,
      selection: {
        curriculum: curriculumId,
        prior_attempts: selected.attempts,
        prior_average: selected.average,
        paced: Boolean(tempoBpm),
        tempo_bpm: tempoBpm,
      },
    };
  }
}

export default PianoScaleChallengePolicy;
