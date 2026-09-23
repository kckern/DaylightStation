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

/** The key a reviewed food-name → icon map is matched on. */
export const normalizeIconFoodName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normalizeName = normalizeIconFoodName;

/**
 * Names whose nearest-looking art is a known MISMATCH (see confineIcon): they
 * get their own exact slug or nothing, never a near neighbour.
 */
const EXACT_ONLY_NAMES = new Set(['white fish', 'fish taco', 'ranch', 'ranch dressing', 'cream sauce', 'white sauce',
  'diced ham', 'scrambled eggs', 'plain yogurt', 'oikos pro plain',
  'chia seeds', 'organic chia seed', 'organic chia seeds']);

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
  // whipped cream ≠ cream sauce, a tortilla ≠ the dish it contains,
  // ham ≠ a cheeseburger, and plain ingredients ≠ prepared desserts.
  // A reviewed manifest alias above can supply a suitable asset later.
  if (EXACT_ONLY_NAMES.has(name)) {
    const exact = name.replaceAll(' ', '-');
    return vocabulary.has(exact) ? exact : NEUTRAL_ICON;
  }
  if (typeof icon !== 'string' || !icon) return NEUTRAL_ICON;
  return vocabulary.has(icon) ? icon : NEUTRAL_ICON;
}

// Words that describe a food rather than name it. Never matched on their own
// ("organic" is not a picture), though they still take part in longer runs.
const MODIFIER_WORDS = new Set(['and', 'with', 'the', 'of', 'in', 'on', 'organic', 'fresh', 'raw', 'cooked', 'plain',
  'large', 'small', 'medium', 'whole', 'low', 'fat', 'free', 'diet', 'light', 'lite', 'sliced', 'diced', 'chopped',
  'shredded', 'grilled', 'baked', 'fried', 'roasted', 'frozen', 'natural', 'original', 'classic', 'style', 'vanilla',
  'chocolate', 'unsweetened', 'sweetened', 'reduced', 'extra', 'premium', 'brand', 'pack', 'serving']);

const pluralForms = (word) => {
  const forms = [word];
  if (word.endsWith('ies') && word.length > 4) forms.push(`${word.slice(0, -3)}y`);
  else if (word.endsWith('es') && word.length > 3) forms.push(word.slice(0, -2), word.slice(0, -1));
  else if (word.endsWith('s') && word.length > 3) forms.push(word.slice(0, -1));
  else forms.push(`${word}s`);
  return forms;
};

/**
 * The closest OFFERED icon for a food name, or the neutral sentinel.
 *
 * For a catalog entry that never received an icon (a UPC product, a food the
 * model named no icon for) — so a suggestion can show a picture instead of
 * the bowl. Deliberately conservative:
 *   1. a reviewed food-name alias or an exact-only name decides outright
 *      (confineIcon's rules — a known mismatch is never guessed around);
 *   2. otherwise the longest contiguous run of the name's words that IS an
 *      offered slug wins ("Organic Fuji Apple" → `apple`, "Fried Egg" →
 *      `fried-eggs`), later words first at equal length because English puts
 *      the head noun last ("Strawberry Smoothie" is a smoothie);
 *   3. nothing else: no substring matching (`shake` must not find
 *      `salt-and-pepper-shakers`), and single modifier words never match.
 *
 * `vocabulary` is the OFFERED set (iconVocabulary over the manifest's `icons`),
 * never aliases, so the answer can never point at retired flat art.
 *
 * @param {string} foodName
 * @param {Set<string>} vocabulary
 * @returns {string} an offered slug, or NEUTRAL_ICON
 */
export function guessIconForName(foodName, vocabulary) {
  const name = normalizeName(foodName);
  if (!name || !vocabulary?.size) return NEUTRAL_ICON;
  if (vocabulary.foodNames?.has(name) || EXACT_ONLY_NAMES.has(name)) return confineIcon(null, vocabulary, foodName);
  const words = name.split(' ').filter(Boolean);
  for (let size = Math.min(words.length, 4); size >= 1; size -= 1) {
    for (let start = words.length - size; start >= 0; start -= 1) {
      const run = words.slice(start, start + size);
      if (size === 1 && (MODIFIER_WORDS.has(run[0]) || run[0].length < 3 || /^\d/.test(run[0]))) continue;
      const head = run.slice(0, -1).join('-');
      for (const last of pluralForms(run[run.length - 1])) {
        const slug = head ? `${head}-${last}` : last;
        if (vocabulary.has(slug)) return slug;
      }
    }
  }
  return NEUTRAL_ICON;
}
