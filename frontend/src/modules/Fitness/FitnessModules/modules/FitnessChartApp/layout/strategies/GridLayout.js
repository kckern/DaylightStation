import { compareAvatars } from '../utils/sort.js';

export class GridLayout {
  constructor(config = {}) {
    this.minGap = config.minGap || 64;
    this.columns = config.columns || 2;
  }

  apply(avatars) {
    if (avatars.length < 2) return avatars;

    // Sort by Y, then value (if available)
    const sorted = [...avatars].sort(compareAvatars);

    const count = sorted.length;
    const rows = Math.ceil(count / this.columns);
    const baseX = sorted[0].x;
    const centroidY = sorted.reduce((sum, a) => sum + a.y, 0) / count;
    
    const totalHeight = (rows - 1) * this.minGap;
    const startY = centroidY - (totalHeight / 2);

    return sorted.map((avatar, index) => {
      const row = Math.floor(index / this.columns);
      const col = index % this.columns;

      return {
        ...avatar,
        finalX: baseX + (col * this.minGap), // Spread right
        finalY: startY + (row * this.minGap),
        strategy: 'grid'
      };
    });
  }
}
