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

// `macros` are PERCENT OF CALORIES and must sum to 100 (ScanNutritionService
// derives grams from them; validateScanConfig asserts the sum). These splits are
// a WORKING FALLBACK — hand-estimated to be plausible for what each tier
// describes, not measured. Replace them with real figures in the `nutribot:`
// block of scales.yml when the table is tuned against actual foods.
export const DEFAULT_DENSITY_LEVELS = [
  { level: 1, label: 'Watery', emoji: '🥬', kcal_per_g: 0.2, hint: 'broth, greens', macros: { fat_pct: 10, carb_pct: 60, protein_pct: 30 } },
  { level: 2, label: 'Light', emoji: '🥗', kcal_per_g: 0.6, hint: 'salad, fruit', macros: { fat_pct: 15, carb_pct: 70, protein_pct: 15 } },
  { level: 3, label: 'Lean', emoji: '🍲', kcal_per_g: 1.0, hint: 'soup, lean meat', macros: { fat_pct: 20, carb_pct: 45, protein_pct: 35 } },
  { level: 4, label: 'Mixed', emoji: '🍛', kcal_per_g: 1.4, hint: 'rice + veg + protein', macros: { fat_pct: 25, carb_pct: 50, protein_pct: 25 } },
  { level: 5, label: 'Hearty', emoji: '🍝', kcal_per_g: 1.9, hint: 'pasta, casserole', macros: { fat_pct: 30, carb_pct: 50, protein_pct: 20 } },
  { level: 6, label: 'Heavy', emoji: '🍕', kcal_per_g: 2.6, hint: 'pizza, fried', macros: { fat_pct: 40, carb_pct: 45, protein_pct: 15 } },
  { level: 7, label: 'Rich', emoji: '🧀', kcal_per_g: 3.8, hint: 'cheese, creamy', macros: { fat_pct: 65, carb_pct: 15, protein_pct: 20 } },
  { level: 8, label: 'Thick', emoji: '🥜', kcal_per_g: 6.0, hint: 'nuts, nut butter', macros: { fat_pct: 75, carb_pct: 15, protein_pct: 10 } },
  { level: 9, label: 'Oil', emoji: '🫒', kcal_per_g: 8.5, hint: 'oil, butter', macros: { fat_pct: 100, carb_pct: 0, protein_pct: 0 } },
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
        .map((l) => {
          const out = {
            level: Number(l.level),
            label: l.label || `L${l.level}`,
            emoji: l.emoji || '🍽',
            kcal_per_g: Number(l.kcal_per_g),
            hint: l.hint || '',
          };
          // Passed through untouched: ScanNutritionService validates these and
          // treats a blank macros (throws) differently from a blank per_100g
          // (tolerated). Defaulting either here would mask a bad table.
          if (l.macros !== undefined) out.macros = l.macros;
          if (l.per_100g !== undefined) out.per_100g = l.per_100g;
          return out;
        })
    : DEFAULT_DENSITY_LEVELS;

  return {
    minGrams: num(nb.min_grams, DEFAULT_MIN_GRAMS),
    baselineToleranceG: num(nb.baseline_tolerance_g, 6),
    placementDeltaG: num(nb.placement_delta_g, 10),
    dedupDeltaG: num(nb.dedup_delta_g, 5),
    storageWeightG: num(nb.storage_weight_g, 0),
    storageToleranceG: num(nb.storage_tolerance_g, 15),
    suspicionWindowSec: num(nb.suspicion_window_sec, 90),
    stormMinPushes: num(nb.storm_min_pushes, 2),
    heavyG: num(nb.heavy_g, 300),
    forceToleranceG: num(nb.force_tolerance_g, 10),
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

export function buildDensityKeyboard(cfg, encodeCallback, logUuid, opts = {}) {
  const showingHelp = opts.showingHelp === true;
  // UI shows emoji + word label only; the numeric level rides in the callback payload.
  const buttons = cfg.densityLevels.map((l) => ({
    text: `${l.emoji} ${l.label}`,
    callback_data: encodeCallback('sd', { id: logUuid, l: l.level }),
  }));
  const helpBtn = showingHelp
    ? { text: '⬅️ Back', callback_data: encodeCallback('sh', { id: logUuid, h: 0 }) }
    : { text: '❓ Help', callback_data: encodeCallback('sh', { id: logUuid, h: 1 }) };
  const controlRow = [
    { text: '📦 Container', callback_data: encodeCallback('st', { id: logUuid }) },
    helpBtn,
    { text: '❌ Cancel', callback_data: encodeCallback('x', { id: logUuid }) },
  ];
  return [...chunk(buttons, 3), controlRow]; // 3x3 grid + control row
}

export function buildContainerKeyboard(cfg, encodeCallback, logUuid) {
  const none = [{ text: '🚫 No container', callback_data: encodeCallback('st', { id: logUuid, c: 'none' }) }];
  // UI shows emoji + label only; the tare grams stays server-side, resolved from c.id.
  const containers = cfg.containers.items.map((c) => ({
    text: `${c.emoji} ${c.label}`,
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
  return `⚖️ ${grams} g`;
}

export function densityHelpText(cfg, grams) {
  const lines = cfg.densityLevels.map(
    (l) => `${l.emoji} ${l.label} · ${l.kcal_per_g} kcal/g${l.hint ? `  (${l.hint})` : ''}`,
  );
  return `⚖️ ${grams} g — tap a level or describe it\n\n${lines.join('\n')}`;
}

export function containerPromptText(grams) {
  return `⚖️ ${grams} g — in a container?\n\nPick one to subtract its weight, or "No container".`;
}
