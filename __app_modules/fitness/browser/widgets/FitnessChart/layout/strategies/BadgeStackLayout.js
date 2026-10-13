export class BadgeStackLayout {
  constructor(config = {}) {
    this.minGap = config.minGap || 22; // Badge radius * 2 + 2
  }

  apply(badges) {
    if (badges.length < 2) return badges;

    // Sort by Y
    const sorted = [...badges].sort((a, b) => a.y - b.y);
    
    // Calculate total height
    const totalHeight = (sorted.length - 1) * this.minGap;
    const centroidY = sorted.reduce((sum, b) => sum + b.y, 0) / sorted.length;
    const startY = centroidY - (totalHeight / 2);

    return sorted.map((badge, index) => ({
      ...badge,
      finalY: startY + (index * this.minGap),
      finalX: badge.x, // X is frozen
      strategy: 'badge-stack'
    }));
  }
}
