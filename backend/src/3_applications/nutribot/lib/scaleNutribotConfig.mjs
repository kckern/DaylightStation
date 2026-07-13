//
// Pure config + presentation helpers for the scale→nutribot feature. No I/O.
// Reads the `nutribot` block of scales.yml and supplies defaults so the feature
// works before the real file is edited.

export const DEFAULT_MIN_GRAMS = 5;

export const DEFAULT_CONTAINERS = {
  thresholdG: 150,
  items: [
    { id: 'dinner-plate', label: 'Dinner plate', emoji: '🍽', grams: 340 },
    { id: 'dinner-bowl', label: 'Dinner bowl', emoji: '🥣', grams: 250 },
    { id: 'small-bowl', label: 'Small bowl', emoji: '🍚', grams: 180 },
    { id: 'mug', label: 'Mug', emoji: '☕', grams: 350 },
  ],
};

export const DEFAULT_DENSITY_LEVELS = [
  { level: 1, label: 'Watery', emoji: '🥬', kcal_per_g: 0.2 },
  { level: 2, label: 'Light', emoji: '🥗', kcal_per_g: 0.6 },
  { level: 3, label: 'Lean', emoji: '🍲', kcal_per_g: 1.0 },
  { level: 4, label: 'Everyday', emoji: '🍛', kcal_per_g: 1.4 },
  { level: 5, label: 'Hearty', emoji: '🍝', kcal_per_g: 1.9 },
  { level: 6, label: 'Filling', emoji: '🍕', kcal_per_g: 2.6 },
  { level: 7, label: 'Rich', emoji: '🧀', kcal_per_g: 3.8 },
  { level: 8, label: 'Very rich', emoji: '🥜', kcal_per_g: 6.0 },
  { level: 9, label: 'Pure fat', emoji: '🫒', kcal_per_g: 8.5 },
];

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function normalizeScaleNutribotConfig(raw = {}) {
  const nb = (raw && raw.nutribot) || {};

  const items = Array.isArray(nb.containers?.items) && nb.containers.items.length
    ? nb.containers.items
        .filter((c) => c && c.id && Number.isFinite(Number(c.grams)))
        .map((c) => ({ id: String(c.id), label: c.label || c.id, emoji: c.emoji || '📦', grams: Number(c.grams) }))
    : DEFAULT_CONTAINERS.items;

  const densityLevels = Array.isArray(nb.density_levels) && nb.density_levels.length
    ? nb.density_levels
        .filter((l) => l && Number.isFinite(Number(l.level)) && Number.isFinite(Number(l.kcal_per_g)))
        .map((l) => ({ level: Number(l.level), label: l.label || `L${l.level}`, emoji: l.emoji || '🍽', kcal_per_g: Number(l.kcal_per_g) }))
    : DEFAULT_DENSITY_LEVELS;

  return {
    minGrams: num(nb.min_grams, DEFAULT_MIN_GRAMS),
    containers: {
      thresholdG: num(nb.containers?.threshold_g, DEFAULT_CONTAINERS.thresholdG),
      items,
    },
    densityLevels,
  };
}

export function densityForLevel(cfg, level) {
  const n = Number(level);
  return cfg.densityLevels.find((l) => l.level === n) || null;
}

function chunk(arr, size) {
  const rows = [];
  for (let i = 0; i < arr.length; i += size) rows.push(arr.slice(i, i + size));
  return rows;
}

export function buildDensityKeyboard(cfg, encodeCallback, logUuid) {
  const buttons = cfg.densityLevels.map((l) => ({
    text: `${l.emoji} ${l.label}`,
    callback_data: encodeCallback('sd', { id: logUuid, l: l.level }),
  }));
  // Always offer a container (tare) affordance, even when the reading was below
  // the prompt threshold (e.g. a light item on a paper towel or small plate).
  // 'st' with no `c` = "show the container picker" (SelectScaleContainer show mode).
  const containerRow = [{ text: '📦 On a container?', callback_data: encodeCallback('st', { id: logUuid }) }];
  return [...chunk(buttons, 5), containerRow]; // rows of 5 + container affordance
}

export function buildContainerKeyboard(cfg, encodeCallback, logUuid) {
  const none = [{ text: '🚫 No container', callback_data: encodeCallback('st', { id: logUuid, c: 'none' }) }];
  const containers = cfg.containers.items.map((c) => ({
    text: `${c.emoji} ${c.label} −${c.grams}`,
    callback_data: encodeCallback('st', { id: logUuid, c: c.id }),
  }));
  return [none, ...chunk(containers, 3)];
}

export function buildConfirmButtons(encodeCallback, logUuid) {
  return [[
    { text: '✅ Accept', callback_data: encodeCallback('a', { id: logUuid }) },
    { text: '✏️ Revise', callback_data: encodeCallback('r', { id: logUuid }) },
    { text: '🗑️ Discard', callback_data: encodeCallback('x', { id: logUuid }) },
  ]];
}

export function densityPromptText(grams) {
  return `⚖️ ${grams} g — what is it?\n\nTap a density level, or just describe it and I'll estimate.`;
}

export function containerPromptText(grams) {
  return `⚖️ ${grams} g — in a container?\n\nPick one to subtract its weight, or "No container".`;
}
