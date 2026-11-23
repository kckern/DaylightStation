/**
 * What counts as a region track. One rule, two readers: the player (contentFilter.js decides
 * regional vs whole-frame blur) and the review list (reviewRows.mjs, the row's `tracked`, which
 * the effect menu's Blur caption reads).
 */

/** A keyframe where the tracker did not see its subject: no cells and not whole-frame. */
export const isTrackGap = (k) => !k?.whole && !(k?.cells && k.cells.length);

/** A region track that saw its subject at least once (an all-gap track hides nothing regionally). */
export const hasSighting = (regions) => Array.isArray(regions) && regions.some((k) => !isTrackGap(k));
