// Continuous card sizing, bounded for readable text and a quiet single rider.
export const RIDER_MIN_PX = 64;
export const RIDER_SINGLE_CAP_PX = 132;
// Row gap between roster children. At the 64px floor the tight gap wins back
// overhead (five riders + three headers = 7 gaps x 6px) before anything scrolls.
export const RIDER_GAP_PX = 10;
export const RIDER_GAP_TIGHT_PX = 4;

// singleCap: 132 keeps a lone rider's card quiet; with an HR trend to draw the
// card may grow to TREND_SINGLE_CAP_PX (hrTrend.js) so the chart fills it.
export function allocateRiderHeight({ room, overhead, count, singleCap = RIDER_SINGLE_CAP_PX }) {
  if (!count) return RIDER_MIN_PX;
  const height = Math.floor((room - overhead) / count);
  return Math.max(RIDER_MIN_PX, count === 1 ? Math.min(singleCap, height) : height);
}

// Picks the gap and the card height together. `content` is the non-card
// height with NO gaps in it, so the answer does not depend on the gap the
// grid currently wears: switching gap can never feed back into the choice.
export function allocateRiderLayout({ room, content, gaps, count, singleCap }) {
  const at = (gap) => allocateRiderHeight({ room, overhead: content + gaps * gap, count, singleCap });
  const roomy = Math.floor((room - content - gaps * RIDER_GAP_PX) / Math.max(1, count));
  if (!count || roomy >= RIDER_MIN_PX) return { height: at(RIDER_GAP_PX), gap: RIDER_GAP_PX };
  return { height: at(RIDER_GAP_TIGHT_PX), gap: RIDER_GAP_TIGHT_PX };
}

export function measureRiderLayout(container, content, { singleCap } = {}) {
  const grid = content?.querySelector('.device-grid');
  if (!container || !grid) return { height: RIDER_MIN_PX, gap: RIDER_GAP_PX };
  const style = getComputedStyle(container);
  const room = container.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
  const children = [...grid.children].filter(child => getComputedStyle(child).position !== 'absolute');
  let count = 0;
  let nonCard = 0;
  for (const child of children) {
    const card = child.querySelector('.fitness-device.card-horizontal.heart-rate');
    // Measure each occupied child rather than grid.scrollHeight. FlipMove may
    // retain a previous grid height or animate transforms during a roster edit.
    nonCard += child.getBoundingClientRect().height;
    if (card) {
      count++;
      nonCard -= card.getBoundingClientRect().height;
    }
  }
  return allocateRiderLayout({ room, content: nonCard, gaps: Math.max(0, children.length - 1), count, singleCap });
}

export function measureRiderHeight(container, content) {
  return measureRiderLayout(container, content).height;
}
