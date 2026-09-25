/**
 * User-configurable settings for the nutrition auditor: which model runs it,
 * how often and how expensively, which changes may start a run, and which
 * kinds of repair it may propose. Pure; persistence and clocks live upstream.
 */
// OpenAI models only: NutritionAuditor sends each as 'openai/<name>'.
export const AUDITOR_MODELS = ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-5.6-luna'];
export const TRIGGER_KINDS = ['captures', 'reviews', 'stabilization', 'scaleReconcile', 'artwork', 'dayRollover', 'edits', 'dailySweep'];
export const PERMISSION_KINDS = ['naming', 'identification', 'mealPlacement', 'grouping', 'artwork', 'portion', 'nutrients', 'estimates', 'completeCaptures', 'questions'];
export const MIN_GAP_CHOICES = [0, 15, 30, 60];
export const MAX_DAILY_CAP_USD = 50;

export const DEFAULT_AUDITOR_SETTINGS = Object.freeze({ enabled: false, dryRun: true, telegram: false,
  model: 'gpt-4.1-mini', dailyCapUsd: 1, minGapMinutes: 15,
  triggers: Object.freeze(Object.fromEntries(TRIGGER_KINDS.map(k => [k, true]))),
  permissions: Object.freeze(Object.fromEntries(PERMISSION_KINDS.map(k => [k, true]))) });

const FIELD_KIND = { name: 'naming', label: 'naming', foodId: 'identification', date: 'mealPlacement', mealTime: 'mealPlacement',
  parentId: 'grouping', kind: 'grouping', icon: 'artwork', photoRef: 'artwork', amount: 'portion', unit: 'portion', grams: 'portion' };
// Plain words for the model's prompt, in PERMISSION_KINDS order.
const KIND_LABEL = { naming: 'food names', identification: 'product matches', mealPlacement: 'meal dates and times',
  grouping: 'food groupings', artwork: 'icons and photos', portion: 'portions', nutrients: 'nutrient values',
  estimates: 'estimated nutrients', completeCaptures: 'captures waiting for review' };

export const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pick = (stored, keys, defaults) => Object.fromEntries(keys.map(key =>
  [key, typeof stored?.[key] === 'boolean' ? stored[key] : defaults[key]]));
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };

/** Stored settings over the defaults; unknown keys and invalid stored values fall back to the default. Always a fresh object. */
export function effectiveSettings(stored = {}) {
  const source = isPlain(stored) ? stored : {};
  const settings = { ...DEFAULT_AUDITOR_SETTINGS };
  for (const key of Object.keys(settings)) {
    if (!(key in source) || ['triggers', 'permissions'].includes(key)) continue;
    try { validateSettingsChange({ [key]: source[key] }); settings[key] = source[key]; } catch { /* keep the default */ }
  }
  settings.triggers = pick(isPlain(source.triggers) ? source.triggers : {}, TRIGGER_KINDS, DEFAULT_AUDITOR_SETTINGS.triggers);
  settings.permissions = pick(isPlain(source.permissions) ? source.permissions : {}, PERMISSION_KINDS, DEFAULT_AUDITOR_SETTINGS.permissions);
  return settings;
}

/** Rejects (status 400) any change that is not a well-formed partial of the settings. */
export function validateSettingsChange(changes) {
  if (!isPlain(changes)) invalid('Invalid settings');
  for (const [key, value] of Object.entries(changes)) {
    if (!(key in DEFAULT_AUDITOR_SETTINGS)) invalid(`Unknown setting: ${key}`);
    if (['enabled', 'dryRun', 'telegram'].includes(key) && typeof value !== 'boolean') invalid(`${key} must be true or false`);
    if (key === 'model' && !AUDITOR_MODELS.includes(value)) invalid('Unknown model');
    if (key === 'dailyCapUsd' && value !== null
      && !(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_DAILY_CAP_USD)) invalid('Invalid daily cap');
    if (key === 'minGapMinutes' && !MIN_GAP_CHOICES.includes(value)) invalid('Invalid minimum gap');
    if (key === 'triggers' || key === 'permissions') {
      const known = key === 'triggers' ? TRIGGER_KINDS : PERMISSION_KINDS;
      if (!isPlain(value)) invalid(`Invalid ${key}`);
      for (const [kind, on] of Object.entries(value)) {
        if (!known.includes(kind) || typeof on !== 'boolean') invalid(`Invalid ${key}: ${kind}`);
      }
    }
  }
  return true;
}

/** The permission kinds a repair proposal exercises. Accepts object or {field,value}-list changes. */
export function permissionKindsOf(proposal) {
  const kinds = new Set();
  if (proposal?.mode === 'complete') kinds.add('completeCaptures');
  if (proposal?.mode === 'estimate') kinds.add('estimates');
  if (proposal?.createGroups?.length) kinds.add('grouping');
  for (const { changes } of proposal?.updates || []) {
    const fields = Array.isArray(changes) ? changes.map(change => change.field) : Object.keys(changes || {});
    for (const field of fields) kinds.add(FIELD_KIND[field] ?? 'nutrients');
  }
  return kinds;
}

/** The kinds a proposal touches that `permissions` switches off. */
export function blockedKinds(proposal, permissions) {
  return [...permissionKindsOf(proposal)].filter(kind => permissions?.[kind] === false);
}

/** One prompt sentence naming what the auditor may not touch; '' when everything is allowed. */
export function describeDisabled(permissions) {
  const off = PERMISSION_KINDS.filter(kind => permissions?.[kind] === false);
  const fields = off.filter(kind => kind !== 'questions').map(kind => KIND_LABEL[kind]);
  return [
    ...(fields.length ? [`You are not permitted to change: ${fields.join(', ')}. Do not propose these; leave them as they are.`] : []),
    ...(off.includes('questions') ? ['Do not ask questions.'] : []),
  ].join(' ');
}
