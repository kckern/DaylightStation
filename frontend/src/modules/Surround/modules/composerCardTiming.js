// composerCardTiming.js — dissolve timing aliases for ComposerCard.jsx, split
// out so Fast Refresh can hot-reload the card component on its own.
import { DISSOLVE_FADE_MS, DISSOLVE_HOLD_MS } from '../dissolve.js';

/** Each half of the dissolve — the house duration, shared with the ticker. */
export const COMPOSER_FACT_FADE_MS = DISSOLVE_FADE_MS;
/** The beat of empty ground between the two halves ("through black"). */
export const COMPOSER_FACT_HOLD_MS = DISSOLVE_HOLD_MS;
