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

const DEFAULT_MACROS_BY_LEVEL = new Map(
  DEFAULT_DENSITY_LEVELS.map((d) => [d.level, d.macros]),
);

// Attaching a cosmetic field (an `icon:`) must not cost a required one. An
// override that omits `macros` borrows the default for its LEVEL rather than
// disabling nutriscan wholesale, which is what dropping them used to do.
// A level with no default keeps `undefined` so validateScanConfig still
// refuses it by name.
const withMacros = (row) => (
  row.macros ? row : { ...row, macros: DEFAULT_MACROS_BY_LEVEL.get(row.level) }
);

export function normalizeScaleNutribotConfig(raw = {}) {
  const nb = (raw && raw.nutribot) || {};

  const items = Array.isArray(nb.containers?.items) && nb.containers.items.length
    ? nb.containers.items
        .filter((c) => c && c.id && Number.isFinite(Number(c.grams)))
        // `icon` is printed-sheet decoration. It is listed EXPLICITLY because this
        // mapper rebuilds each row from a fixed field list, so anything unlisted is
        // silently dropped — which happened twice: once here and once in the density
        // mapper below. Both times the config was right, the sheet rendered without
        // pictures, and nothing errored. Adding a field to either table means adding
        // it here too.
        .map((c) => ({
          id: String(c.id),
          label: c.label || c.id,
          emoji: c.emoji || '📦',
          grams: Number(c.grams),
          icon: c.icon || null,
          // Draw scale for the icon, 1 = full size. Lets two vessels share one piece
          // of artwork and still be told apart — the smaller sibling renders smaller.
          icon_scale: Number.isFinite(Number(c.icon_scale)) ? Number(c.icon_scale) : null,
        }))
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
            // Printed-sheet decoration, resolved to SVG by the sheet's icon loader.
            // This mapper rebuilds each level from an explicit field list, so an
            // unlisted key is silently dropped — which is exactly what happened to
            // `icon` first time round: the config had it, the sheet rendered blank
            // gaps where the pictures should have been, and nothing errored.
            icon: l.icon || null,
          };
          // Passed through untouched. `computeNutrition` (ScanNutritionService)
          // validates these when a density level is applied, and treats a blank
          // macros (throws) differently from a blank per_100g (tolerated).
          // Defaulting either here would mask a bad table.
          if (l.macros !== undefined) out.macros = l.macros;
          if (l.per_100g !== undefined) out.per_100g = l.per_100g;
          return out;
        })
        .map(withMacros)
    : DEFAULT_DENSITY_LEVELS;

  // Common-foods list for the printed fridge sheet. There is NO default table:
  // an absent `foods:` means the block renders empty, which is the honest state
  // before anyone has written the list. Rows are shaped, not filtered — nothing
  // here is encoded into a scan code (no `fd:` grammar exists), so no row can be
  // unprintable, and dropping a malformed one would put a silent hole in a
  // laminated sheet. When a food grammar lands, validateScanConfig must REJECT
  // unprintable ids the way it already does for containers, rather than this
  // normalizer quietly discarding them.
  const foods = Array.isArray(nb.foods)
    ? nb.foods
        .filter((f) => f && typeof f === 'object')
        .map((f) => {
          const out = { id: String(f.id ?? f.label ?? ''), label: String(f.label ?? f.id ?? '') };
          if (f.sublabel !== undefined) out.sublabel = String(f.sublabel);
          return out;
        })
    : [];

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
    foods,
  };
}

// Tolerant of a nullish level and of a config with no table: it is called on the
// render path, where "no density selected yet" is the normal case and must not
// be confused with level 0 (`Number(null) === 0`), and a partial config must
// degrade to "no density line" rather than throw mid-prompt.
export function densityForLevel(cfg, level) {
  if (level === null || level === undefined || level === '') return null;
  const n = Number(level);
  if (!Number.isFinite(n)) return null;
  return (cfg?.densityLevels || []).find((l) => l.level === n) || null;
}

/**
 * Resolve a SCANNED density code (kcal per 100 g) to its config row.
 *
 * Separate from `densityForLevel` because the two lookups take different keys and
 * must not be conflated. The Telegram keyboard round-trips the ORDINAL level in
 * its callback payload; the printed QR carries the PHYSICAL value. Collapsing
 * them into one function would make `4` ambiguous — rung 4, or 0.04 kcal/g?
 *
 * Matches on `round(kcal_per_g * 100)` rather than on a stored code field, so the
 * config has one source of truth for the calorie figure and cannot drift from
 * what the sheet printed (`sheetProviders` derives the printed code the same way).
 *
 * @param {object} cfg Normalized nutribot config.
 * @param {number} kcalPer100g As returned by `parseScan`.
 * @returns {object|null} The density row, or null when no row carries that value.
 */
export function densityForCode(cfg, kcalPer100g) {
  if (!Number.isFinite(Number(kcalPer100g))) return null;
  const code = Number(kcalPer100g);
  return (cfg?.densityLevels || [])
    .find((l) => Math.round(Number(l.kcal_per_g) * 100) === code) || null;
}

/**
 * Resolve a SCANNED tare (grams) to its container row.
 *
 * The tare itself needs no lookup — the scanned number IS the weight to subtract.
 * This exists for the row's label, emoji and id, which the ack renders and the
 * store keys on. A miss is therefore NOT fatal to the arithmetic, but callers
 * still reject it: an unrecognised tare means the sheet and the table disagree,
 * and guessing would log a plausible wrong number.
 *
 * @param {object} cfg Normalized nutribot config.
 * @param {number} grams As returned by `parseScan`.
 * @returns {object|null} The container row, or null when no row carries that tare.
 */
export function containerForTare(cfg, grams) {
  if (!Number.isFinite(Number(grams))) return null;
  const g = Number(grams);
  return (cfg?.containers?.items || []).find((c) => Number(c.grams) === g) || null;
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
