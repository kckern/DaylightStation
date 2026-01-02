export class LabelManager {
  constructor(config = {}) {
    this.avatarRadius = config.avatarRadius || 30;
    this.labelGap = config.labelGap || 8;
    this.labelWidth = config.labelWidth || 50; // Estimated width
    this.labelHeight = config.labelHeight || 20;
  }

  resolve(avatars) {
    // Sort by X (rightmost first) to resolve labels from right to left?
    // Or just iterate.
    
    // We need to check collisions against ALL avatars (final positions).
    // We assume avatars have { x, y, offsetX, offsetY } set.
    
    return avatars.map(avatar => {
      const ax = avatar.x + (avatar.offsetX || 0);
      const ay = avatar.y + (avatar.offsetY || 0);
      
      // Default: Right
      let labelPos = 'right';
      
      // Check if 'right' placement collides with any other avatar
      if (this.checkCollision(ax, ay, 'right', avatars, avatar.id)) {
        // Try Left
        if (!this.checkCollision(ax, ay, 'left', avatars, avatar.id)) {
          labelPos = 'left';
        } else {
          // Try Top
          if (!this.checkCollision(ax, ay, 'top', avatars, avatar.id)) {
            labelPos = 'top';
          } else {
             // Try Bottom
             if (!this.checkCollision(ax, ay, 'bottom', avatars, avatar.id)) {
               labelPos = 'bottom';
             }
             // If all fail, stick to right (or hide?)
          }
        }
      }
      
      return { ...avatar, labelPosition: labelPos };
    });
  }

  checkCollision(ax, ay, position, allAvatars, selfId) {
    const labelRect = this.getLabelRect(ax, ay, position);
    
    return allAvatars.some(other => {
      if (other.id === selfId) return false;
      
      const ox = other.x + (other.offsetX || 0);
      const oy = other.y + (other.offsetY || 0);
      
      // Check collision with other avatar body
      // Circle vs Rect collision
      // Simplify to Rect vs Rect for performance
      const otherRect = {
        x: ox - this.avatarRadius,
        y: oy - this.avatarRadius,
        width: this.avatarRadius * 2,
        height: this.avatarRadius * 2
      };
      
      return this.rectIntersect(labelRect, otherRect);
    });
  }

  getLabelRect(ax, ay, position) {
    const r = this.avatarRadius;
    const g = this.labelGap;
    const w = this.labelWidth;
    const h = this.labelHeight;
    
    switch (position) {
      case 'right':
        return { x: ax + r + g, y: ay - h/2, width: w, height: h };
      case 'left':
        return { x: ax - r - g - w, y: ay - h/2, width: w, height: h };
      case 'top':
        return { x: ax - w/2, y: ay - r - g - h, width: w, height: h };
      case 'bottom':
        return { x: ax - w/2, y: ay + r + g, width: w, height: h };
      default:
        return { x: ax + r + g, y: ay - h/2, width: w, height: h };
    }
  }

  rectIntersect(r1, r2) {
    return !(r2.x > r1.x + r1.width || 
             r2.x + r2.width < r1.x || 
             r2.y > r1.y + r1.height ||
             r2.y + r2.height < r1.y);
  }
}
