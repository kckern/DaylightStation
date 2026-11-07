/**
 * Plain household settings <-> content-filter profile fragments.
 *
 * Four settings: language - five groups (profanity, blasphemy, sexual, slurs,
 * childish), each mute|bleep|off (R9) - and violence / nudity / sexual
 * (off|blur|blackout|skip). A group is stored as category `language/<group>`. `profilePatchFromSettings` yields the `categories`
 * and `scenes` fragments they own; `mergeProfilePatch` lays a fragment over a
 * profile (patch wins per key; name, treatments, theme, requiresCertification
 * are never touched); `settingsFromProfile` reads settings back.
 */
import { LANGUAGE_GROUPS, LANGUAGE_DEFAULTS } from './languageGroups.mjs';

export { LANGUAGE_GROUPS, LANGUAGE_DEFAULTS };
export const LANGUAGE_VALUES = ['mute', 'bleep', 'off'];
export const LEVELS = ['off', 'blur', 'blackout', 'skip'];

/** Categories each level-setting owns, and the scene group it rules. */
const GROUPS = {
  violence: { categories: ['violence_blood_gore/graphic', 'violence_blood_gore/gore'], parents: ['violence_blood_gore'], group: 'violence_blood_gore' },
  nudity: { categories: ['sex_nudity_immodesty', 'nudity'], parents: [], group: 'sex_nudity_immodesty' },
  sexual: { categories: ['sex_any', 'sex_any/sexual_assault'], parents: [], group: 'sex_any' },
};
export const OWNED_SCENE_GROUPS = Object.values(GROUPS).map((g) => g.group);

const isOn = (effect) => !!effect && effect !== 'off';
const effectOf = (profile, key) => {
  const v = profile?.categories?.[key];
  return v && typeof v === 'object' ? v.effect : v;
};

function sceneFor(level, key) {
  if (level === 'blackout') return { blackout: { picture: 2 } };
  if (level === 'skip') return key === 'sexual' ? { blackout: { picture: 2 }, skip: { situation: 3 } } : { skip: { picture: 2 } };
  return {};
}

/** A language setting as all five groups: a legacy single value fills every group; gaps take the defaults. */
export function normalizeLanguage(value) {
  const out = {};
  for (const g of LANGUAGE_GROUPS) {
    const v = typeof value === 'string' ? value : value?.[g];
    out[g] = LANGUAGE_VALUES.includes(v) ? v : LANGUAGE_DEFAULTS[g];
  }
  return out;
}

/** Overlay partial settings on current ones; `language` merges per group (a legacy string sets all five). */
export function mergeSettings(current = {}, partial = {}) {
  const out = { ...current, ...partial };
  if ('language' in partial) {
    out.language = typeof partial.language === 'string'
      ? normalizeLanguage(partial.language)
      : { ...(current.language || {}), ...(partial.language || {}) };
  }
  return out;
}

export function profilePatchFromSettings(settings = {}) {
  const categories = {};
  const scenes = {};
  const language = normalizeLanguage(settings.language);
  for (const g of LANGUAGE_GROUPS) categories[`language/${g}`] = { effect: language[g] };
  for (const [key, g] of Object.entries(GROUPS)) {
    const level = LEVELS.includes(settings[key]) ? settings[key] : 'off';
    for (const c of g.parents) categories[c] = { effect: 'off' };
    for (const c of g.categories) categories[c] = { effect: level === 'off' ? 'off' : 'full-blur' };
    scenes[g.group] = sceneFor(level, key); // {} = explicitly none, so it overrides a base entry
  }
  return { categories, scenes };
}

export function settingsFromProfile(profile) {
  const legacy = effectOf(profile, 'language');
  const language = {};
  for (const g of LANGUAGE_GROUPS) {
    const e = effectOf(profile, `language/${g}`) ?? legacy;
    language[g] = e === 'mute' || e === 'bleep' ? e : 'off';
  }
  const out = { language };
  for (const [key, g] of Object.entries(GROUPS)) {
    const scene = profile?.scenes?.[g.group] || {};
    if (scene.skip) out[key] = 'skip';
    else if (scene.blackout) out[key] = 'blackout';
    else out[key] = g.categories.some((c) => isOn(effectOf(profile, c))) ? 'blur' : 'off';
  }
  return out;
}

/** Overlay a patch ({ categories, scenes }) on a profile; the patch wins per key. Pure. */
export function mergeProfilePatch(profile, patch) {
  if (!profile) return profile;
  if (!patch || (!patch.categories && !patch.scenes && !patch.languageWords)) return profile;
  return {
    ...profile,
    categories: { ...(profile.categories || {}), ...(patch.categories || {}) },
    scenes: { ...(profile.scenes || {}), ...(patch.scenes || {}) },
    ...(patch.languageWords ? { languageWords: { ...(profile.languageWords || {}), ...patch.languageWords } } : {}),
  };
}

/** Write form: merge, then drop owned scene groups that ended up empty. */
export function applySettingsToProfile(profile, settings) {
  const merged = mergeProfilePatch(profile || {}, profilePatchFromSettings(settings));
  const scenes = { ...merged.scenes };
  for (const g of OWNED_SCENE_GROUPS) if (scenes[g] && !Object.keys(scenes[g]).length) delete scenes[g];
  return { ...merged, scenes };
}
