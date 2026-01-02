import { compareAvatars } from '../utils/sort.js';

export class StackLayout {
  constructor(config = {}) {
    this.minGap = config.minGap || 80; // AVATAR_RADIUS * 2 + 20 for proper spacing
  }

  apply(avatars) {
    if (avatars.length < 3) return avatars;

    // Sort by original Y (top to bottom)
    const sorted = [...avatars].sort(compareAvatars);
    
    // Calculate total height of stack
    const totalHeight = (sorted.length - 1) * this.minGap;
    const centroidY = sorted.reduce((sum, a) => sum + a.y, 0) / sorted.length;
    const startY = centroidY - (totalHeight / 2);

    return sorted.map((avatar, index) => ({
      ...avatar,
      finalY: startY + (index * this.minGap),
      finalX: avatar.x, // Keep X position
      strategy: 'stack'
    }));
  }
}
