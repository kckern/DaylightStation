/**
 * Plain household settings <-> content-filter profile fragments.
 *
 * Four settings: language (mute|bleep|off) and violence / nudity / sexual
 * (off|blur|blackout|skip). `profilePatchFromSettings` yields the `categories`
 * and `scenes` fragments they own; `mergeProfilePatch` lays a fragment over a
 * profile (patch wins per key; name, treatments, theme, requiresCertification
 * are never touched); `settingsFromProfile` reads settings back.
 */
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

export function profilePatchFromSettings(settings = {}) {
  const categories = {};
  const scenes = {};
  const language = LANGUAGE_VALUES.includes(settings.language) ? settings.language : 'off';
  categories.language = { effect: language };
  for (const [key, g] of Object.entries(GROUPS)) {
    const level = LEVELS.includes(settings[key]) ? settings[key] : 'off';
    for (const c of g.parents) categories[c] = { effect: 'off' };
    for (const c of g.categories) categories[c] = { effect: level === 'off' ? 'off' : 'full-blur' };
    scenes[g.group] = sceneFor(level, key); // {} = explicitly none, so it overrides a base entry
  }
  return { categories, scenes };
}

export function settingsFromProfile(profile) {
  const language = effectOf(profile, 'language');
  const out = { language: language === 'mute' || language === 'bleep' ? language : 'off' };
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
  if (!patch || (!patch.categories && !patch.scenes)) return profile;
  return {
    ...profile,
    categories: { ...(profile.categories || {}), ...(patch.categories || {}) },
    scenes: { ...(profile.scenes || {}), ...(patch.scenes || {}) },
  };
}

/** Write form: merge, then drop owned scene groups that ended up empty. */
export function applySettingsToProfile(profile, settings) {
  const merged = mergeProfilePatch(profile || {}, profilePatchFromSettings(settings));
  const scenes = { ...merged.scenes };
  for (const g of OWNED_SCENE_GROUPS) if (scenes[g] && !Object.keys(scenes[g]).length) delete scenes[g];
  return { ...merged, scenes };
}
