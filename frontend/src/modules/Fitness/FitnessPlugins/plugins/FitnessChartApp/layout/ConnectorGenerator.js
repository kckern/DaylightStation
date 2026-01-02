/**
 * ConnectorGenerator - creates horizontal connector lines for displaced avatars
 * Only generates connectors for avatars that have been moved LEFT (negative offsetX)
 */
export class ConnectorGenerator {
  constructor(config = {}) {
    this.avatarRadius = config.avatarRadius || 30;
  }

  generate(elements) {
    return elements
      .filter(e => {
        // Only generate connectors for avatars moved leftward
        if (e.type !== 'avatar') return false;
        const offsetX = e.offsetX || 0;
        return offsetX < -5; // Moved left by more than 5px
      })
      .map(e => {
        // Original position (line anchor point)
        const originX = e.x;
        const originY = e.y;
        
        // Avatar's displaced position (left edge of avatar)
        const avatarCenterX = e.x + (e.offsetX || 0);
        const avatarRightEdge = avatarCenterX + this.avatarRadius;
        
        // Horizontal line from anchor to avatar's right edge
        return {
          id: `connector-${e.id}`,
          x1: originX,
          y1: originY,
          x2: avatarRightEdge,
          y2: originY, // Same Y - purely horizontal
          color: e.color
        };
      });
  }
}
