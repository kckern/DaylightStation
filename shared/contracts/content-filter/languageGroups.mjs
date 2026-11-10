/**
 * Language groups (R9): one alias table maps both taxonomies onto five groups.
 *
 *   VidAngel categories          word-list groups (bad-words.yml / srt-mutes)
 *   profanity, profanity_captions  profanity
 *   blasphemy                      blasphemy
 *   language_sexual                vulgarity
 *   language_racial                racial
 *   language_childish              childish
 *
 * A cue category is `language/<group>/<leaf>` (the leaf is the spoken word on
 * word-list cues, VidAngel's `other_*` / a word on its own cues). The group is
 * the first path segment after `language` the table knows.
 */
export const LANGUAGE_GROUPS = ['profanity', 'blasphemy', 'sexual', 'slurs', 'childish'];

/** Default effect per group when a profile says nothing (R9). */
export const LANGUAGE_DEFAULTS = Object.freeze({ profanity: 'mute', blasphemy: 'mute', sexual: 'mute', slurs: 'mute', childish: 'off' });

const ALIASES = {
  profanity: 'profanity', profanity_captions: 'profanity', swearing: 'profanity', other_profanity: 'profanity',
  blasphemy: 'blasphemy', other_blasphemy: 'blasphemy',
  sexual: 'sexual', language_sexual: 'sexual', other_sexual: 'sexual', vulgarity: 'sexual',
  slurs: 'slurs', language_racial: 'slurs', racial: 'slurs', other_racial: 'slurs',
  childish: 'childish', language_childish: 'childish', other_childish: 'childish',
};

/** Group named by one taxonomy term (either taxonomy), or null. */
export function groupOfTerm(term) {
  return ALIASES[String(term || '').toLowerCase()] ?? null;
}

const segmentsOf = (category) => String(category || '').split('/');
export const isLanguageCategory = (category) => segmentsOf(category)[0] === 'language';

/**
 * The group a language cue belongs to; null when the category is not language.
 * A language category with no recognisable group term (bare `language`,
 * `language/x`) counts as profanity: the general bucket.
 */
export function languageGroupOf(category) {
  const segs = segmentsOf(category);
  if (segs[0] !== 'language') return null;
  for (const s of segs.slice(1)) {
    const g = groupOfTerm(s);
    if (g) return g;
  }
  return 'profanity';
}

const CLEAN_WORD = /^[a-z][a-z'’-]*$/i;

/**
 * The word a language cue is about, lower-case, for `languageWords` lookup: the
 * category leaf when it names a word (`language/profanity/damn` -> damn), else
 * the label when it is one uncensored word. Censored labels ("G*d") and
 * descriptions give null.
 */
export function languageWordOf(cue) {
  const segs = segmentsOf(cue?.category);
  if (segs[0] === 'language' && segs.length >= 3) {
    const leaf = segs[segs.length - 1].toLowerCase();
    if (!groupOfTerm(leaf) && leaf !== 'other' && CLEAN_WORD.test(leaf)) return leaf;
  }
  const label = String(cue?.label || '').trim();
  return CLEAN_WORD.test(label) ? label.toLowerCase() : null;
}
