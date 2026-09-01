/**
 * Horizontal layout for the gutter's video-change cards.
 *
 * Each card is anchored to its own change line, so two videos that started close
 * together produce two cards that overlap. The images are opaque and the later
 * card paints on top, so the collision that actually hurts is the CAPTION: two
 * runs of unrelated text drawn over each other.
 *
 * This resolves that by budgeting each caption the room it actually has before
 * the neighbouring card, rather than a fixed width. The caption wraps to two
 * lines inside that budget and truncates past it; when there is no readable room
 * at all the caption is dropped and only the poster strip identifies the change.
 */

// Must match MarkerGutter.scss: the card's offset from its change line and the
// width of the poster+thumb strip a caption sits under.
export const CARD_OFFSET_PX = 6;
export const CARD_IMGS_W_PX = 110;
export const CAPTION_MAX_W_PX = 140;
export const CARD_GAP_PX = 8;
/** Below this the caption is more noise than label — drop it and keep the posters. */
export const CAPTION_MIN_W_PX = 32;
/** A card whose line sits within this of the right edge flips to grow leftward. */
export const FLIP_ZONE_PX = 170;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {Array<{x: number}>} markers - video markers, ascending by x
 * @param {number} width - measured gutter width; 0 while unmeasured
 * @returns {Array<{flip: boolean, captionWidth: number|null, zIndex: number}>}
 *   one entry per marker, index-aligned. `captionWidth` null = hide the caption.
 */
export function layoutVideoCards(markers, width) {
  if (!Array.isArray(markers) || markers.length === 0) return [];
  const flips = markers.map((m) => width > 0 && m.x > width - FLIP_ZONE_PX);

  // The span a card occupies, treating every card as its full width — the
  // caption budget can only shrink from here, never grow, so this stays a
  // conservative bound rather than a circular dependency.
  const nearEdge = (i) => (flips[i] ? markers[i].x - CARD_OFFSET_PX - CAPTION_MAX_W_PX : markers[i].x + CARD_OFFSET_PX);
  const farEdge = (i) => (flips[i] ? markers[i].x - CARD_OFFSET_PX : markers[i].x + CARD_OFFSET_PX + CAPTION_MAX_W_PX);

  return markers.map((m, i) => {
    const flip = flips[i];
    const anchor = flip ? m.x - CARD_OFFSET_PX : m.x + CARD_OFFSET_PX;
    // The gap only buys separation from a neighbour; against the gutter's own
    // edge there is nothing to separate from.
    const hasNeighbour = flip ? i > 0 : i + 1 < markers.length;
    const gap = hasNeighbour ? CARD_GAP_PX : 0;
    let avail;
    if (!flip) {
      const limit = hasNeighbour ? nearEdge(i + 1) : (width > 0 ? width : anchor + CAPTION_MAX_W_PX);
      avail = limit - anchor - gap;
    } else {
      const limit = hasNeighbour ? farEdge(i - 1) : 0;
      avail = anchor - limit - gap;
    }
    const budget = clamp(avail, 0, CAPTION_MAX_W_PX);
    return {
      flip,
      captionWidth: budget < CAPTION_MIN_W_PX ? null : budget,
      // Later change wins the overlap, so the newest card reads on top.
      zIndex: i + 1,
    };
  });
}

export default layoutVideoCards;
