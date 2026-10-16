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
        const offsetY = e.offsetY || 0;
        // Displaced left (horizontal pass / clamping) or up/down (vertical stack)
        return offsetX < -5 || Math.abs(offsetY) > 5;
      })
      .map(e => {
        // Original position (line anchor point) - where the data line ends
        // This is always e.x since we now preserve original positions
        const originX = e.x;
        const originY = e.y;
        
        // Avatar's final rendered position
        const avatarCenterX = e.x + (e.offsetX || 0);
        const avatarCenterY = e.y + (e.offsetY || 0);
        const movedLeft = (e.offsetX || 0) < -5;
        // Moved left: meet the avatar's right edge. Moved only vertically: meet the
        // edge facing the line end, so the connector never crosses the face.
        const x2 = movedLeft ? avatarCenterX + this.avatarRadius : avatarCenterX;
        const y2 = movedLeft
          ? avatarCenterY
          : avatarCenterY + (originY > avatarCenterY ? this.avatarRadius : -this.avatarRadius);
        return {
          id: `connector-${e.id}`,
          x1: originX,
          y1: originY,
          x2,
          y2,
          color: e.color
        };
      });
  }
}
