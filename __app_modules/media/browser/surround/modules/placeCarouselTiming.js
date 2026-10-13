// placeCarouselTiming.js — dissolve timing alias for PlaceCarousel.jsx, split
// out so Fast Refresh can hot-reload the carousel component on its own.
import { DISSOLVE_FADE_MS } from "../../../../../__capabilities/playback/browser/surround-dissolve.mjs";

/** Each half of the dissolve — the house duration, shared with both fact rotations. */
export const PLACE_FADE_MS = DISSOLVE_FADE_MS;
