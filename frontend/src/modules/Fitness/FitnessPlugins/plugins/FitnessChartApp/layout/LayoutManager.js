import { ClusterDetector } from './ClusterDetector.js';
import { StrategySelector } from './StrategySelector.js';
import { ConnectorGenerator } from './ConnectorGenerator.js';
import { BadgeStackLayout } from './strategies/BadgeStackLayout.js';
import { LabelManager } from './LabelManager.js';

export class LayoutManager {
  constructor(config = {}) {
    this.bounds = config.bounds || { width: 0, height: 0, margin: { top: 0, right: 0, bottom: 0, left: 0 } };
    this.avatarRadius = config.avatarRadius || 30;
    this.badgeRadius = config.badgeRadius || 10;
    this.options = {
      minSpacing: 4,
      maxDisplacement: 100,
      enableConnectors: false,
      maxBadgesPerUser: 3,
      ...config.options
    };
    
    this.clusterDetector = new ClusterDetector({ 
      clusterThreshold: this.avatarRadius * 4  // Increased from 3 to 4 for better grouping
    });
    
    this.badgeClusterDetector = new ClusterDetector({
      clusterThreshold: this.badgeRadius * 2.5
    });
    
    this.strategySelector = new StrategySelector({
      minGap: this.avatarRadius * 2 + 20, // Increased gap: diameter (60px) + 20px padding
      avatarRadius: this.avatarRadius,
      radius: 100,
      columns: 2
    });

    this.badgeStackLayout = new BadgeStackLayout({
      minGap: this.badgeRadius * 2 + 2
    });

    this.connectorGenerator = new ConnectorGenerator({
      threshold: this.avatarRadius * 1.5,
      avatarRadius: this.avatarRadius
    });

    this.labelManager = new LabelManager({
      avatarRadius: this.avatarRadius,
      labelGap: 8,
      labelWidth: 50, // Estimate
      labelHeight: 20
    });
  }

  layout(elements) {
    // Separate avatars and badges
    let avatars = elements.filter(e => e.type === 'avatar');
    let badges = elements.filter(e => e.type === 'badge');

    // Filter badges: max N per user (most recent)
    if (this.options.maxBadgesPerUser > 0) {
      const badgesByUser = {};
      badges.forEach(b => {
        const pid = b.participantId || 'unknown';
        if (!badgesByUser[pid]) badgesByUser[pid] = [];
        badgesByUser[pid].push(b);
      });
      
      badges = Object.values(badgesByUser).flatMap(userBadges => {
        // Sort by tick (descending) to keep most recent
        return userBadges
          .sort((a, b) => (b.tick || 0) - (a.tick || 0))
          .slice(0, this.options.maxBadgesPerUser);
      });
    }

    // Phase 1: Clamp avatar BASE positions to bounds FIRST
    // This ensures collision resolution operates on final X positions
    avatars = this._clampBasePositions(avatars, 'avatar');

    // Phase 2: Simple vertical push-apart collision resolution
    // Sort by Y position, then push overlapping avatars down
    let resolvedAvatars = this._resolveCollisionsSimple(avatars);

    // Phase 6: Label Collision Resolution
    resolvedAvatars = this.labelManager.resolve(resolvedAvatars);

    // Phase 7: Final bounds check (clamp offsets if they pushed avatars out)
    resolvedAvatars = this._clampToBounds(resolvedAvatars, 'avatar');

    // Phase 5: Badge layout
    const badgeClusters = this.badgeClusterDetector.detectClusters(badges);
    const positionedBadges = badgeClusters.flatMap(cluster => {
      if (cluster.length < 2) return cluster;
      return this.badgeStackLayout.apply(cluster);
    });
    
    let resolvedBadges = positionedBadges.map(b => {
      const finalX = b.finalX ?? b.x;
      const finalY = b.finalY ?? b.y;
      
      // Badge aging: fade out near left edge
      const leftEdge = this.bounds.margin.left || 0;
      const fadeZone = 50; // pixels
      let opacity = 1;
      if (finalX < leftEdge + fadeZone) {
        opacity = Math.max(0, (finalX - leftEdge) / fadeZone);
      }

      return {
        ...b,
        x: b.x,
        y: b.y,
        offsetX: finalX - b.x,
        offsetY: finalY - b.y,
        opacity
      };
    });

    // Phase 5.4: Handle badge-avatar collisions (Badge yields)
    resolvedBadges = this._resolveBadgeAvatarCollisions(resolvedBadges, resolvedAvatars);

    // Phase 5.5: Clamp badges to bounds
    resolvedBadges = this._clampToBounds(resolvedBadges, 'badge');

    // Phase 4: Generate connectors
    let connectors = [];
    if (this.options.enableConnectors) {
      connectors = this.connectorGenerator.generate(resolvedAvatars);
    }

    return {
      elements: [...resolvedAvatars, ...resolvedBadges],
      connectors
    };
  }

  _resolveBadgeAvatarCollisions(badges, avatars) {
    const MIN_DIST = this.avatarRadius + this.badgeRadius;
    
    return badges.map(badge => {
      const bx = badge.x + (badge.offsetX || 0);
      const by = badge.y + (badge.offsetY || 0);
      
      const collides = avatars.some(avatar => {
        const ax = avatar.x + (avatar.offsetX || 0);
        const ay = avatar.y + (avatar.offsetY || 0);
        const dist = Math.hypot(bx - ax, by - ay);
        return dist < MIN_DIST;
      });

      if (collides) {
        // Fade out significantly if colliding with an avatar
        return { ...badge, opacity: (badge.opacity || 1) * 0.2 };
      }
      return badge;
    });
  }

  /**
   * Simple iterative collision resolution - push overlapping avatars apart vertically.
   * @param {Array} avatars - Avatars with x, y positions
   * @returns {Array} Avatars with offsetX, offsetY applied
   */
  _resolveCollisionsSimple(avatars) {
    if (!avatars || avatars.length === 0) return [];
    if (avatars.length === 1) {
      return [{ ...avatars[0], offsetX: 0, offsetY: 0 }];
    }

    const DIAMETER = this.avatarRadius * 2;
    const MIN_GAP = 10; // Minimum gap between avatar edges
    const MIN_DISTANCE = DIAMETER + MIN_GAP; // 70px for radius 30

    // Sort by Y position (top to bottom), then by value (higher values first if same Y)
    const sorted = [...avatars].sort((a, b) => {
      const yDiff = a.y - b.y;
      if (Math.abs(yDiff) < 10) {
        // Nearly same Y, sort by value descending so higher values stay on top
        return (b.value || 0) - (a.value || 0);
      }
      return yDiff;
    });

    const result = [];
    
    for (let i = 0; i < sorted.length; i++) {
      const avatar = sorted[i];
      let offsetY = 0;
      
      // Check against all already-placed avatars
      for (const placed of result) {
        const placedY = placed.y + (placed.offsetY || 0);
        const currentY = avatar.y + offsetY;
        const dx = Math.abs(avatar.x - placed.x);
        const dy = currentY - placedY;
        
        // Only check collision if X positions are similar (within 2x radius)
        if (dx < MIN_DISTANCE) {
          // If vertically within collision range, push down
          if (Math.abs(dy) < MIN_DISTANCE) {
            // Calculate how much to push down to avoid collision
            const pushNeeded = MIN_DISTANCE - dy;
            if (pushNeeded > 0) {
              offsetY += pushNeeded;
            }
          }
        }
      }
      
      result.push({
        ...avatar,
        offsetX: 0,
        offsetY
      });
    }

    return result;
  }

  /**
   * Clamp elements to stay fully visible within bounds.
   * Avatars need extra margin for radius + labels; badges just need radius.
   * @param {Array} elements - Elements with x, y, offsetX, offsetY
   * @param {'avatar'|'badge'} type - Element type
   */
  _clampToBounds(elements, type) {
    const { width, height, margin } = this.bounds;
    const radius = type === 'avatar' ? this.avatarRadius : this.badgeRadius;
    
    // For avatars, account for label on the right side (coin count)
    // Labels are typically ~50px wide, but we use a conservative estimate
    const labelMargin = type === 'avatar' ? 50 : 0;
    
    // Calculate the safe zone where element centers can be placed
    const minX = (margin.left || 0) + radius;
    const maxX = width - (margin.right || 0) - radius - labelMargin;
    const minY = (margin.top || 0) + radius;
    const maxY = height - (margin.bottom || 0) - radius;
    
    return elements.map(el => {
      const currentX = el.x + (el.offsetX || 0);
      const currentY = el.y + (el.offsetY || 0);
      
      // Clamp to safe zone
      let clampedX = Math.max(minX, Math.min(maxX, currentX));
      let clampedY = Math.max(minY, Math.min(maxY, currentY));
      
      // Calculate the required offset adjustment
      const adjustX = clampedX - currentX;
      const adjustY = clampedY - currentY;
      
      if (adjustX === 0 && adjustY === 0) {
        return el; // No clamping needed
      }
      
      // If we're clamping to the right edge, switch label to left side
      let labelPosition = el.labelPosition;
      if (type === 'avatar' && currentX > maxX) {
        labelPosition = 'left';
      }
      
      return {
        ...el,
        offsetX: (el.offsetX || 0) + adjustX,
        offsetY: (el.offsetY || 0) + adjustY,
        labelPosition,
        _clamped: true // Debug flag
      };
    });
  }

  /**
   * Clamp base positions of elements BEFORE collision detection.
   * This modifies x/y directly (not offsets) so strategies operate on clamped positions.
   * Stores original position in _originalX/_originalY for connector generation.
   * @param {Array} elements - Elements with x, y
   * @param {'avatar'|'badge'} type - Element type
   */
  _clampBasePositions(elements, type) {
    const { width, height, margin } = this.bounds;
    const radius = type === 'avatar' ? this.avatarRadius : this.badgeRadius;
    
    // For avatars, account for label on the right side (coin count)
    const labelMargin = type === 'avatar' ? 50 : 0;
    
    // Calculate the safe zone where element centers can be placed
    const minX = (margin.left || 0) + radius;
    const maxX = width - (margin.right || 0) - radius - labelMargin;
    const minY = (margin.top || 0) + radius;
    const maxY = height - (margin.bottom || 0) - radius;
    
    return elements.map(el => {
      const originalX = el.x;
      const originalY = el.y;
      
      // Clamp to safe zone
      const clampedX = Math.max(minX, Math.min(maxX, originalX));
      const clampedY = Math.max(minY, Math.min(maxY, originalY));
      
      const wasClampedX = clampedX !== originalX;
      const wasClampedY = clampedY !== originalY;
      
      if (!wasClampedX && !wasClampedY) {
        return el; // No clamping needed
      }
      
      // If we're clamping to the right edge, switch label to left side
      let labelPosition = el.labelPosition;
      if (type === 'avatar' && originalX > maxX) {
        labelPosition = 'left';
      }
      
      return {
        ...el,
        x: clampedX,
        y: clampedY,
        _originalX: originalX, // Store for connector generation
        _originalY: originalY,
        labelPosition,
        _baseClamped: true // Debug flag
      };
    });
  }
}
