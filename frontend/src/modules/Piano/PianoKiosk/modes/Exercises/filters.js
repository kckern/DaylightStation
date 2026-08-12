/**
 * The filter vocabulary of the exercise browser.
 *
 * Separate from the view so the card game and the browser agree on what a
 * filter is, and so the option lists can be asserted in tests.
 */

export const DEFAULT_FILTERS = Object.freeze({
  mode: 'free',
  levelMin: 1,
  levelMax: 10,
  collection: null,
  form: null,
  hands: null,
  tags: null,
});

/** How strictly the attempt is judged. Ordered easiest to hardest. */
export const MODE_OPTIONS = Object.freeze([
  { id: 'free', label: 'Free', blurb: 'Play it at your own pace' },
  { id: 'metronome', label: 'With a click', blurb: 'Start when you like, stay in time' },
  { id: 'cued', label: 'On the beat', blurb: 'Count in, then play on the downbeat' },
]);

/** What kind of thing it is. Values match the bank's derived `form`. */
export const FORM_OPTIONS = Object.freeze([
  { id: null, label: 'Everything' },
  { id: 'note', label: 'Single notes' },
  { id: 'interval', label: 'Intervals' },
  { id: 'chord', label: 'Chords' },
  { id: 'scale', label: 'Scales' },
  { id: 'figure', label: 'Figures' },
  { id: 'progression', label: 'Progressions' },
]);

export const HAND_OPTIONS = Object.freeze([
  { id: null, label: 'Either hand' },
  { id: 'right', label: 'Right hand' },
  { id: 'left', label: 'Left hand' },
  { id: 'both', label: 'Both hands' },
]);

/**
 * Level bands, named rather than numbered.
 *
 * A number from 1 to 10 means nothing to a child at a piano; "just starting"
 * does. The numbers stay underneath for the query and for progression.
 */
export const LEVEL_BANDS = Object.freeze([
  { id: 'any', label: 'Any level', min: 1, max: 10 },
  { id: 'starting', label: 'Just starting', min: 1, max: 2 },
  { id: 'getting-it', label: 'Getting it', min: 3, max: 4 },
  { id: 'steady', label: 'Steady', min: 5, max: 6 },
  { id: 'stretching', label: 'Stretching', min: 7, max: 8 },
  { id: 'hardest', label: 'Hardest', min: 9, max: 10 },
]);

export function bandFor(min, max) {
  return LEVEL_BANDS.find((band) => band.min === min && band.max === max) ?? null;
}
