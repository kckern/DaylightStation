/**
 * StraddleLayout - handles 2 avatar collision avoidance
 * When avatars would overlap, move the LOWER one (by Y position) leftward
 * with a connector back to its line anchor point.
 */
export class StraddleLayout {
  constructor(config = {}) {
    this.minGap = config.minGap || 80; // AVATAR_RADIUS * 2 + 20 for proper spacing
    this.avatarRadius = config.avatarRadius || 30;
  }

  apply(avatars) {
    if (avatars.length !== 2) return avatars;

    // Sort by Y position - lower Y value = higher on screen (top)
    const sorted = [...avatars].sort((a, b) => a.y - b.y);
    const topAvatar = sorted[0];    // Higher on screen (lower Y)
    const bottomAvatar = sorted[1]; // Lower on screen (higher Y)
    
    // Calculate vertical distance between avatar centers
    const verticalDistance = bottomAvatar.y - topAvatar.y;
    // Overlap threshold: if avatars are closer than diameter + generous padding, they overlap
    const overlapThreshold = this.avatarRadius * 2.5; // ~75px for radius 30
    
    // If they would overlap vertically
    if (verticalDistance < overlapThreshold) {
      // Move the bottom avatar leftward to avoid collision
      const horizontalOffset = -(this.avatarRadius * 3); // Move left by 3x radius = 90px
      
      return [
        { 
          ...topAvatar, 
          finalX: topAvatar.x, 
          finalY: topAvatar.y, 
          strategy: 'straddle' 
        },
        { 
          ...bottomAvatar, 
          finalX: bottomAvatar.x + horizontalOffset, 
          finalY: bottomAvatar.y, 
          strategy: 'straddle' 
        }
      ];
    }
    
    // If there's enough vertical space, no adjustment needed
    return [
      { ...topAvatar, finalY: topAvatar.y, finalX: topAvatar.x, strategy: 'straddle' },
      { ...bottomAvatar, finalY: bottomAvatar.y, finalX: bottomAvatar.x, strategy: 'straddle' }
    ];
  }
}
