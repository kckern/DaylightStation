/**
 * ConnectorGenerator - creates horizontal connector lines for displaced avatars
 * Generates connectors for avatars that have been moved LEFT (negative offsetX)
 * This includes avatars clamped due to bounds constraints.
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
        // Check if avatar was displaced left (by clamping or collision resolution)
        return offsetX < -5; // Moved left by more than 5px
      })
      .map(e => {
        // Original position (line anchor point) - where the data line ends
        // This is always e.x since we now preserve original positions
        const originX = e.x;
        const originY = e.y;
        
        // Avatar's final rendered position
        const avatarCenterX = e.x + (e.offsetX || 0);
        const avatarCenterY = e.y + (e.offsetY || 0);
        const avatarRightEdge = avatarCenterX + this.avatarRadius;
        
        // Line from anchor point to avatar's right edge
        // Use avatar's final Y for the endpoint (in case of vertical displacement too)
        return {
          id: `connector-${e.id}`,
          x1: originX,
          y1: originY,
          x2: avatarRightEdge,
          y2: avatarCenterY,
          color: e.color
        };
      });
  }
}
