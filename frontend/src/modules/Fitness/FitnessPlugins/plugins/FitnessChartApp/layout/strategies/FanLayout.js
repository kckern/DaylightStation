import { compareAvatars } from '../utils/sort.js';

export class FanLayout {
  constructor(config = {}) {
    this.minGap = config.minGap || 64;
    this.radius = config.radius || 100; // Radius of the fan arc
  }

  apply(avatars) {
    if (avatars.length < 3) return avatars;

    const sorted = [...avatars].sort(compareAvatars);
    const count = sorted.length;
    const centroidY = sorted.reduce((sum, a) => sum + a.y, 0) / count;
    const baseX = sorted[0].x; // Assume similar X

    // Calculate angle spread (e.g., -60 to +60 degrees)
    const totalAngle = Math.min(120, count * 20) * (Math.PI / 180);
    const startAngle = -totalAngle / 2;
    const angleStep = totalAngle / (count - 1);

    return sorted.map((avatar, index) => {
      const angle = startAngle + (index * angleStep);
      // Fan out to the right
      const offsetX = Math.cos(angle) * this.radius;
      const offsetY = Math.sin(angle) * this.radius;

      return {
        ...avatar,
        finalX: baseX + offsetX, // Push right
        finalY: centroidY + offsetY,
        strategy: 'fan'
      };
    });
  }
}
