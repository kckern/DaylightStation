const DEFAULT_STEPS = Object.freeze([
  { completedGames: 0, offset: 0 },
  { completedGames: 1, offset: 1 },
  { completedGames: 2, offset: 2 },
  { completedGames: 3, offset: 3 },
  { completedGames: 4, offset: 4 },
  { completedGames: 5, offset: 6 },
  { completedGames: 6, offset: 8 },
]);

export const DAILY_ESCALATION_DEFAULTS = Object.freeze({
  enabled: false,
  steps: DEFAULT_STEPS,
  capstoneAfter: 7,
  capstoneLevel: null,
});

const whole = (value, fallback = 0) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

export function resolveDailyEscalation(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const authored = Array.isArray(source.steps) ? source.steps : DEFAULT_STEPS;
  const steps = authored
    .map((step) => ({ completedGames: whole(step?.completedGames), offset: whole(step?.offset) }))
    .sort((a, b) => a.completedGames - b.completedGames)
    .filter((step, index, all) => index === 0 || step.completedGames !== all[index - 1].completedGames);
  return {
    enabled: source.enabled === true,
    steps: steps.length ? steps : [...DEFAULT_STEPS],
    capstoneAfter: whole(source.capstoneAfter, 7),
    capstoneLevel: typeof source.capstoneLevel === 'string' ? source.capstoneLevel : null,
  };
}

export function resolveLearnerPath(levels, path) {
  if (!Array.isArray(path) || !path.length) return levels;
  const floor = levels[0];
  const seen = new Set();
  const selected = [];
  if (floor) {
    seen.add(floor.id);
    selected.push(floor);
  }
  path.forEach((id) => {
    const level = levels.find((candidate) => candidate.id === id);
    if (level && !seen.has(level.id)) {
      seen.add(level.id);
      selected.push(level);
    }
  });
  return selected.length > 1 ? selected : levels;
}

export function dailyChallengeLevel({ levels, baseLevelId, completedGames = 0, config, floorLevelId = null }) {
  const baseIndex = Math.max(0, levels.findIndex((level) => level.id === baseLevelId));
  if (!config?.enabled) {
    const level = levels[baseIndex] || levels[0];
    return { level, baseIndex, effectiveIndex: baseIndex, dailyStage: 0, offset: 0 };
  }
  const count = whole(completedGames);
  let offset = 0;
  let dailyStage = 0;
  config.steps.forEach((step, index) => {
    if (count >= step.completedGames) { offset = step.offset; dailyStage = index; }
  });
  let effectiveIndex = Math.min(levels.length - 1, baseIndex + offset);
  if (count >= config.capstoneAfter && config.capstoneLevel) {
    const capstoneIndex = levels.findIndex((level) => level.id === config.capstoneLevel);
    if (capstoneIndex >= 0) effectiveIndex = capstoneIndex;
    dailyStage = 'capstone';
  }
  const floorIndex = levels.findIndex((level) => level.id === floorLevelId);
  if (floorIndex >= 0) effectiveIndex = Math.max(effectiveIndex, floorIndex);
  return { level: levels[effectiveIndex], baseIndex, effectiveIndex, dailyStage, offset };
}
