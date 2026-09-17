// playCardTiming.js — dissolve timing aliases for PlayCard.jsx, split out so
// Fast Refresh can hot-reload the card component on its own — same idiom as
// composerCardTiming.js.
import { DISSOLVE_FADE_MS, DISSOLVE_HOLD_MS } from '../dissolve.js';

export const PLAY_FACT_FADE_MS = DISSOLVE_FADE_MS;
export const PLAY_FACT_HOLD_MS = DISSOLVE_HOLD_MS;
/** Coprime with the footer ticker's 20s and the composer card's 27s. */
export const PLAY_FACT_INTERVAL_MS = 23000;
