/**
 * The effect a content-filter scene earns: the household profile's `scenes:`
 * thresholds, applied only on axes the refined EDL marks trusted
 * (`sceneCalibration`), unless the household's `sceneOverrides` say otherwise.
 *
 * Pure; shared by the player (resolving cues) and the server (which scenes
 * need a title card). Design: ops:docs/superpowers/specs/2026-11-06-content-filter-scenes-design.md
 */

export const SCENE_AXES = ['situation', 'picture'];

// How strongly an effect hides the picture.
export const HIDE_RANK = { blur: 1, 'censor-bar': 1, pixelate: 1, 'full-blur': 2, blackout: 3, skip: 4, 'skip-card': 4 };

/** Axes calibration showed the model can be trusted on. */
export function trustedAxes(edl) {
  const cal = edl?.sceneCalibration || {};
  return new Set(SCENE_AXES.filter((a) => cal[a] === 'trusted'));
}

/** The effect the profile gives a scene ('skip' | 'blackout' | null), from trusted axes only. */
export function profileSceneEffect(scene, profile, trusted) {
  const rules = profile?.scenes || {};
  let best = null;
  for (const g of scene.groups || Object.keys(scene.level || {})) {
    const rule = rules[g]; const lv = scene.level?.[g];
    if (!rule || !lv) continue;
    for (const effect of ['skip', 'blackout']) {
      const meets = Object.entries(rule[effect] || {}).some(([axis, min]) => trusted.has(axis) && lv[axis] >= min);
      if (meets && (!best || HIDE_RANK[effect] > HIDE_RANK[best])) best = effect;
    }
  }
  return best;
}

/** The scene's effect after the household's ruling: null when off or disabled. */
export function sceneEffect(scene, { profile, sceneOverride = {}, trusted }) {
  if (sceneOverride.disabled) return null;
  if (sceneOverride.effect) return sceneOverride.effect === 'off' ? null : sceneOverride.effect;
  return profileSceneEffect(scene, profile, trusted);
}
