// Continuous card sizing, bounded for readable text and a quiet single rider.
export function allocateRiderHeight({ room, overhead, count }) {
  if (!count) return 64;
  const height = Math.floor((room - overhead) / count);
  return Math.max(64, count === 1 ? Math.min(132, height) : height);
}

export function measureRiderHeight(container, content) {
  const grid = content?.querySelector('.device-grid');
  if (!container || !grid) return 64;
  const style = getComputedStyle(container);
  const room = container.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
  const children = [...grid.children].filter(child => getComputedStyle(child).position !== 'absolute');
  const gap = parseFloat(getComputedStyle(grid).rowGap || getComputedStyle(grid).gap) || 0;
  let count = 0;
  let overhead = Math.max(0, children.length - 1) * gap;
  for (const child of children) {
    const card = child.querySelector('.fitness-device.card-horizontal.heart-rate');
    // Measure each occupied child rather than grid.scrollHeight. FlipMove may
    // retain a previous grid height or animate transforms during a roster edit.
    overhead += child.getBoundingClientRect().height;
    if (card) {
      count++;
      overhead -= card.getBoundingClientRect().height;
    }
  }
  return allocateRiderHeight({ room, overhead, count });
}
