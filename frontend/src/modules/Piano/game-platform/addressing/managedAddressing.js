import { rungAt } from './dimensions.js';

const PATHS = Object.freeze({
  staff: Object.freeze([
    { rung: 2 }, { rung: 3 }, { rung: 4 }, { rung: 5 }, { rung: 6 }, { rung: 7 },
    { rung: 7, texture: 'dyad' }, { rung: 7, texture: 'triad' },
  ]),
  chords: Object.freeze([8, 9, 10, 11, 12, 13].map((rung) => ({ rung }))),
});

const DEFAULT_DAILY_STEPS = Object.freeze([
  { completedGames: 0, offset: 0 }, { completedGames: 1, offset: 1 },
  { completedGames: 2, offset: 2 }, { completedGames: 3, offset: 3 },
  { completedGames: 4, offset: 4 }, { completedGames: 5, offset: 6 },
]);

const count = (value) => Math.max(0, Math.floor(Number(value) || 0));

function dailyOffset(config, completedGames) {
  const steps = Array.isArray(config?.steps) ? config.steps : DEFAULT_DAILY_STEPS;
  return steps.reduce((offset, step) => (
    count(completedGames) >= count(step?.completedGames) ? count(step?.offset) : offset
  ), 0);
}

/** Household-managed addressing pressure, independent of opponent and PianoChallenge ladders. */
export function managedAddressingAt(raw, { learnerId, completedGames = 0, completedPlayerMoves = 0 } = {}) {
  if (raw?.enabled !== true) return null;
  const learner = raw.users?.[learnerId];
  if (learner?.enabled === false) return null;
  const vocabulary = learner?.vocabulary === 'staff' ? 'staff'
    : learner?.vocabulary === 'chords' ? 'chords' : null;
  if (!vocabulary) return null;
  const path = PATHS[vocabulary];
  const start = Math.min(path.length - 1, count(learner.startStage));
  const daily = raw.dailyEscalation?.enabled === false ? 0 : dailyOffset(raw.dailyEscalation, completedGames);
  const every = Math.max(1, count(raw.turnEscalation?.everyCompletedMoves) || 1);
  const perStep = Math.max(1, count(raw.turnEscalation?.offsetPerStep) || 1);
  const turn = raw.turnEscalation?.enabled === false
    ? 0 : Math.floor(count(completedPlayerMoves) / every) * perStep;
  const stage = Math.min(path.length - 1, start + daily + turn);
  const step = path[stage];
  const rung = rungAt(step.rung);
  return {
    scheme: null,
    vocabulary,
    clefs: rung.clefs,
    x: rung.x,
    y: rung.y,
    shuffle: rung.shuffle,
    inversions: rung.inversions,
    texture: step.texture ?? 'single',
    managed: { stage, dailyOffset: daily, turnOffset: turn, completedGames, completedPlayerMoves },
  };
}

export default managedAddressingAt;
