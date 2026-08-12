import { searchBank } from '#shared/music/exerciseBank.mjs';

/**
 * Challenge selection from the exercise bank.
 *
 * Replaces the hardcoded curricula the card game used to draw from — four major
 * scales, six chords, three arpeggios, three patterns. Those nineteen items were
 * the whole ceiling of the game; the bank has thousands, already levelled, so
 * selection becomes a query instead of an array index.
 *
 * The adaptive behaviour of the old policy is kept deliberately: fewest attempts
 * first, then weakest average. What changes is the pool it draws from and the
 * fact that the pool is bounded by the player's level rather than by what
 * somebody typed into a constant.
 */

const POLICY_VERSION = 'exercise-bank-v1';

/**
 * Card-game challenge kinds, mapped onto the bank's derived forms.
 *
 * One kind can draw from several forms. A run and a five-finger figure are both
 * "play this pattern in time" as far as the game is concerned, so the bank's
 * `sequence` material — the blues, jazz and rock vocabulary — reaches the table
 * through timed-pattern rather than needing a new kind in the game's schema.
 */
const KIND_TO_FORMS = Object.freeze({
  scale: ['scale'],
  chord: ['chord'],
  arpeggio: ['arpeggio'],
  'timed-pattern': ['figure', 'sequence'],
});

/** Where a player with no history starts, and how far a band reaches. */
const DEFAULT_LEVEL = 2;
const BAND = 1;

function completedAttempts(attempts) {
  return attempts.filter((a) => a?.status === 'completed' && Number.isFinite(a.score));
}

/**
 * The level to aim at, from what the player has actually done.
 *
 * Climbs on sustained success and eases off on struggle. Deliberately slow: a
 * level that chases the last attempt would swing wildly on one bad run.
 */
export function estimateLevel(attempts, { floor = 1, ceiling = 10 } = {}) {
  const completed = completedAttempts(attempts).slice(-12);
  if (completed.length < 3) return DEFAULT_LEVEL;
  const levels = completed.map((a) => a.prompt?.level).filter(Number.isFinite);
  const base = levels.length ? Math.round(levels.reduce((t, n) => t + n, 0) / levels.length) : DEFAULT_LEVEL;
  const average = completed.reduce((total, a) => total + a.score, 0) / completed.length;
  const adjusted = average >= 0.9 ? base + 1 : average < 0.6 ? base - 1 : base;
  return Math.max(floor, Math.min(ceiling, adjusted));
}

function attemptsFor(instanceId, attempts) {
  return attempts.filter((a) => a?.prompt?.exercise_id === instanceId && a.status === 'completed' && Number.isFinite(a.score));
}

/** Fewest attempts first, then weakest average — the old policy's ordering. */
export function rankCandidates(instances, attempts) {
  return instances
    .map((instance) => {
      const seen = attemptsFor(instance.id, attempts);
      const average = seen.length ? seen.reduce((t, a) => t + a.score, 0) / seen.length : null;
      return { instance, attempts: seen.length, average };
    })
    .sort((a, b) => a.attempts - b.attempts || (a.average ?? 1) - (b.average ?? 1) || a.instance.id.localeCompare(b.instance.id));
}

export class BankChallengePolicy {
  #bank;

  constructor({ exerciseBank, attemptStore = null, timeoutMs = 90_000 } = {}) {
    if (!exerciseBank) throw new Error('BankChallengePolicy: exerciseBank required');
    this.#bank = exerciseBank;
    this.attemptStore = attemptStore;
    this.timeoutMs = timeoutMs;
  }

  prepare({ userId, challengeId, kind, requirements = {}, context = {} }) {
    const forms = KIND_TO_FORMS[kind];
    if (!forms) throw new Error(`Unsupported piano challenge kind: ${kind}`);

    const recent = this.attemptStore?.listRecent?.(userId, { limit: 200 }) || [];
    const level = Number.isFinite(requirements.level) ? requirements.level : estimateLevel(recent);
    const mode = requirements.mode || 'free';

    // Widen the band rather than fail: an empty pool would end the game, and a
    // slightly-too-easy exercise is a better answer than no exercise.
    let found = { instances: [] };
    for (let widen = 0; widen <= 9 && !found.instances.length; widen += 1) {
      found = searchBank(this.#bank.allSeeds(), {
        mode,
        form: forms,
        levelMin: Math.max(1, level - BAND - widen),
        levelMax: Math.min(10, level + BAND + widen),
        limit: 200,
      });
    }
    if (!found.instances.length) throw new Error(`No bank material for kind: ${kind}`);

    const ranked = rankCandidates(found.instances, recent);
    const sequence = Number.isInteger(context?.challenge_sequence) ? context.challenge_sequence : 0;
    // Rotate through the equally-stale head of the list so a session does not
    // serve the same exercise twice running.
    const tied = ranked.filter((entry) => entry.attempts === ranked[0].attempts);
    const chosen = tied[((sequence % tied.length) + tied.length) % tied.length];
    const instance = chosen.instance;

    return {
      challenge_id: challengeId,
      kind,
      prompt: {
        exercise_id: instance.id,
        label: promptLabel(instance),
        expected_midi: instance.events.flatMap((e) => e.notes.map((n) => n.midi)),
        ordering: instance.ordering,
        staff: instance.staff,
        level: instance.level?.[mode] ?? null,
        mode,
        // Held-set material is matched on pitch classes and its bass, not on a
        // sequence, so a chord prompt has to carry both or the provider has
        // nothing to compare against.
        ...(instance.ordering === 'any' ? chordTarget(instance) : {}),
      },
      timeout_ms: this.timeoutMs,
      pedagogy_policy_version: POLICY_VERSION,
      selection: {
        curriculum: 'exercise-bank',
        level,
        mode,
        pool: found.total,
        prior_attempts: chosen.attempts,
        prior_average: chosen.average,
      },
    };
  }
}

/** Pitch-class target for chord material, in the shape the provider reads. */
export function chordTarget(instance) {
  const midis = instance.events.flatMap((e) => e.notes.map((n) => n.midi));
  if (!midis.length) return {};
  const pc = (midi) => ((midi % 12) + 12) % 12;
  return {
    // The lowest sounding note: the root in root position, the bass in an
    // inversion — which is exactly what a bass-must-be-root check wants.
    root: pc(Math.min(...midis)),
    pitch_classes: [...new Set(midis.map(pc))].sort((a, b) => a - b),
    allow_inversions: instance.voicing === 'inversions_ok',
  };
}

/**
 * What the card shows.
 *
 * Built from the axes, because every instance of a seed shares the seed's title
 * and "Triads" does not tell a player which of the 288 they were handed. The
 * title is still appended when the axes alone are too thin to identify the
 * thing — a drill transposed to A is "A", which names nothing on its own.
 */
export function promptLabel(instance) {
  const axes = instance.axes ?? {};
  const parts = [axes.root, axes.quality, axes.mode].filter(Boolean).map((v) => String(v).replace(/-/g, ' '));
  if (axes.inversion && axes.inversion !== 'root') parts.push(`${axes.inversion} inversion`);
  if (!parts.length) return instance.title;
  // Root alone is a key, not an exercise.
  if (parts.length === 1 && instance.title) return `${parts[0]} — ${instance.title}`;
  return parts.join(' ');
}

export default BankChallengePolicy;
