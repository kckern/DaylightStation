import { rungAt } from './dimensions.js';

/**
 * Household-managed addressing pressure, independent of opponent and
 * PianoChallenge ladders.
 *
 * THE PRESSURE IS DECIDED WHEN A GAME STARTS AND HELD THERE.
 *
 * It used to climb a stage per completed player move, and on 2026-09-11 a
 * nine-year-old opened a chess game on one octave of treble naturals and was
 * reading four-note dyads on a chromatic board six moves later. 69 refusals
 * against 7 moves, every one of them "that chord is not on the board". Nothing
 * he had learned in the first two minutes was still true, which is not a
 * difficulty ladder, it is the floor moving. So `completedGames` is now the
 * only input: a game is one fixed ask, and the next game is where it gets
 * harder.
 *
 * TWO DIMENSIONS, NOT ONE. The path says what has to be READ — how many notes
 * on a card, and whether they are all naturals. How much the map MOVES —
 * whether the axes are shuffled and how often they are re-dealt — is a separate
 * switch, `cadence`, because it is a separate skill and the household wants it
 * on from the first game rather than arriving as a surprise at stage five.
 */

/**
 * The staff path: texture × material, and nothing else.
 *
 * Rungs are deliberately not used here. A rung bundles vocabulary, tier, order
 * AND cadence, and bundling is exactly what made one step up mean six things at
 * once. Each entry below says only what it changes.
 *
 *   1st game  single notes, naturals
 *   2nd game  single notes, with sharps and flats
 *   3rd game  dyads, naturals
 *   4th game  dyads, with sharps and flats
 *   5th game  triads, naturals
 *   6th game  triads, with sharps and flats
 *
 * Tier 2 is one octave of naturals on each staff; tier 3 is the same plus one
 * accidental per axis. `clefs: grand` throughout — the board is addressed with
 * two hands, the left picking the rank and the right the file, and that does
 * not change as the reading gets harder.
 */
const STAFF_PATH = Object.freeze([
  { tier: 2, texture: 'single' },
  { tier: 3, texture: 'single' },
  { tier: 2, texture: 'dyad' },
  { tier: 3, texture: 'dyad' },
  { tier: 2, texture: 'triad' },
  { tier: 3, texture: 'triad' },
]);

/** The chord path still walks the rungs; its own ladder was never the problem. */
const CHORD_PATH = Object.freeze([8, 9, 10, 11, 12, 13].map((rung) => ({ rung })));

const PATHS = Object.freeze({ staff: STAFF_PATH, chords: CHORD_PATH });

const DEFAULT_DAILY_STEPS = Object.freeze([
  { completedGames: 0, offset: 0 }, { completedGames: 1, offset: 1 },
  { completedGames: 2, offset: 2 }, { completedGames: 3, offset: 3 },
  { completedGames: 4, offset: 4 }, { completedGames: 5, offset: 5 },
]);

/**
 * How much the map moves, for every stage of every path.
 *
 * Shuffling each turn is fine from the first game — it is a different demand
 * from reading a chord, and a child who can find C can find it wherever it is.
 * Stated once so it cannot drift between stages.
 */
const DEFAULT_CADENCE = Object.freeze({ order: 'shuffled', shuffle: 'each_turn' });

const count = (value) => Math.max(0, Math.floor(Number(value) || 0));

function dailyOffset(config, completedGames) {
  const steps = Array.isArray(config?.steps) ? config.steps : DEFAULT_DAILY_STEPS;
  return steps.reduce((offset, step) => (
    count(completedGames) >= count(step?.completedGames) ? count(step?.offset) : offset
  ), 0);
}

/** The configured cadence, or the house one, with each key independently stated. */
function cadenceFor(raw) {
  const stated = (raw?.cadence && typeof raw.cadence === 'object') ? raw.cadence : {};
  return { ...DEFAULT_CADENCE, ...stated };
}

/**
 * @param {object} raw the household's `gameAddressing` config
 * @param {object} options
 * @param {string} options.learnerId
 * @param {number} options.completedGames games this learner has finished today
 */
export function managedAddressingAt(raw, { learnerId, completedGames = 0 } = {}) {
  if (raw?.enabled !== true) return null;
  const learner = raw.users?.[learnerId];
  if (learner?.enabled === false) return null;
  const vocabulary = learner?.vocabulary === 'staff' ? 'staff'
    : learner?.vocabulary === 'chords' ? 'chords' : null;
  if (!vocabulary) return null;

  const path = PATHS[vocabulary];
  const start = Math.min(path.length - 1, count(learner.startStage));
  const daily = raw.dailyEscalation?.enabled === false ? 0 : dailyOffset(raw.dailyEscalation, completedGames);
  const stage = Math.min(path.length - 1, start + daily);
  const step = path[stage];
  const cadence = cadenceFor(raw);

  // A chord stage still borrows its dimensions from its rung; a staff stage
  // states its own. Either way the cadence comes from the switch, not the step,
  // so "harder to read" and "moves around more" stay independently settable.
  const rung = step.rung ? rungAt(step.rung) : null;
  const axis = rung ? null : { tier: step.tier, order: cadence.order };

  return {
    scheme: null,
    vocabulary,
    clefs: rung ? rung.clefs : 'grand',
    x: rung ? { ...rung.x, order: cadence.order } : axis,
    y: rung ? { ...rung.y, order: cadence.order } : axis,
    shuffle: cadence.shuffle,
    inversions: rung ? rung.inversions : undefined,
    texture: step.texture ?? 'single',
    managed: { stage, dailyOffset: daily, completedGames },
  };
}

export default managedAddressingAt;
