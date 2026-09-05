/**
 * Icon confinement for AI-assigned food icons.
 *
 * PRD F5.2 requires the capture agent to choose an icon id "from the manifest
 * list (never inventing names)". The prompt asks for that; nothing enforced it,
 * and a hallucinated slug used to land on the stored row unchallenged. Such a
 * row 404s at the serving route forever after and quietly renders the fallback
 * glyph with nothing logged anywhere — the same silent shape as an emptied
 * media folder.
 *
 * So the model's answer is CHECKED, not trusted, at every mapper that turns a
 * model response into rows. This is the one place that rule is written down.
 */

/**
 * The neutral sentinel: what an item gets when the model named no icon, or
 * named one that is not in the vocabulary. It is a real, resolvable slug (the
 * manifest carries it as a legacy alias), so a row never shows a broken image.
 * It is deliberately NOT donated to the catalog — see FoodCatalogService.
 */
export const NEUTRAL_ICON = 'default';

/**
 * Build a lookup from the space-separated vocabulary the composition root
 * injects as `foodIconsString`.
 * @param {string} foodIconsString
 * @returns {Set<string>}
 */
export function iconVocabulary(foodIconsString, foodNames = {}) {
  const vocabulary = new Set(
    String(foodIconsString || '')
      .split(/\s+/)
      .filter(Boolean),
  );
  vocabulary.foodNames = new Map(Object.entries(foodNames).map(([name, icon]) => [normalizeName(name), icon]));
  return vocabulary;
}

const normalizeName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * @param {unknown} icon - whatever the model put in the `icon` field
 * @param {Set<string>} vocabulary
 * @returns {string} a slug that is either in the vocabulary or the sentinel
 */
export function confineIcon(icon, vocabulary, foodName = '') {
  const name = normalizeName(foodName);
  if (vocabulary.foodNames?.has(name)) {
    const reviewed = vocabulary.foodNames.get(name);
    return vocabulary.has(reviewed) ? reviewed : NEUTRAL_ICON;
  }
  // These observed mismatches are not equivalents: condiments ≠ ranch,
  // whipped cream ≠ cream sauce, and a tortilla ≠ the dish it contains.
  if (['white fish', 'fish taco', 'ranch', 'ranch dressing', 'cream sauce', 'white sauce'].includes(name)) {
    const exact = name.replaceAll(' ', '-');
    return vocabulary.has(exact) ? exact : NEUTRAL_ICON;
  }
  if (typeof icon !== 'string' || !icon) return NEUTRAL_ICON;
  return vocabulary.has(icon) ? icon : NEUTRAL_ICON;
}
