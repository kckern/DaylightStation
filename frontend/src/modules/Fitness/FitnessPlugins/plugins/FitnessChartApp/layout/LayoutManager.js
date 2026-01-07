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
    this.traceEnabled = config.trace || false;
    this.traceLog = [];

    this.clusterDetector = new ClusterDetector({
      // Collision threshold: 2*radius means avatars are touching/overlapping
      collisionThreshold: this.avatarRadius * 2
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

  /**
   * Record a trace entry for debugging layout decisions.
   */
  _trace(phase, elementId, data) {
    if (!this.traceEnabled) return;
    this.traceLog.push({
      phase,
      elementId,
      timestamp: Date.now(),
      ...data
    });
  }

  clearTrace() {
    this.traceLog = [];
  }

  getTrace() {
    return this.traceLog;
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

    if (this.traceEnabled) {
      this.clearTrace();
      avatars.forEach(a => this._trace('input', a.id, { x: a.x, y: a.y, type: 'avatar' }));
      badges.forEach(b => this._trace('input', b.id, { x: b.x, y: b.y, type: 'badge' }));
    }

    // Phase 1: Clamp avatar BASE positions to bounds FIRST
    // This ensures collision resolution operates on final X positions
    avatars = this._clampBasePositions(avatars, 'avatar');

    if (this.traceEnabled) {
      avatars.forEach(a => {
        if (a._baseClamped) {
          this._trace('base_clamp', a.id, {
            before: { x: a.x, y: a.y },
            clampOffset: { x: a._clampOffsetX || 0, y: a._clampOffsetY || 0 }
          });
        }
      });
    }

    // Phase 2: Horizontal-only collision resolution
    // Higher avatars (lower Y value) stay anchored, lower avatars move left
    let resolvedAvatars = this._resolveAvatarCollisionsHorizontal(avatars);

    if (this.traceEnabled) {
      const avatarMap = new Map(avatars.map(a => [a.id, a]));
      resolvedAvatars.forEach(a => {
        const inputA = avatarMap.get(a.id);
        const baseOffsetX = inputA?._clampOffsetX || 0;
        const additionalOffsetX = (a.offsetX || 0) - baseOffsetX;
        if (Math.abs(additionalOffsetX) > 0.1) {
          this._trace('collision_resolve', a.id, {
            before: { offsetX: baseOffsetX },
            after: { offsetX: a.offsetX || 0 },
            delta: { x: additionalOffsetX },
            reason: 'horizontal_collision_avoidance'
          });
        }
      });
    }

    // Phase 3: Label Collision Resolution
    resolvedAvatars = this.labelManager.resolve(resolvedAvatars);

    if (this.traceEnabled) {
      resolvedAvatars.forEach(a => {
        if (a.labelPosition && a.labelPosition !== 'right') {
          this._trace('label_resolve', a.id, { labelPosition: a.labelPosition });
        }
      });
    }

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
      connectors,
      trace: this.traceEnabled ? this.getTrace() : undefined
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
   * Clamp elements to stay fully visible within bounds.
   * Avatars need extra margin for radius + labels; badges just need radius.
   * @param {Array} elements - Elements with x, y, offsetX, offsetY
   * @param {'avatar'|'badge'} type - Element type
   */
  _clampToBounds(elements, type) {
    const { width, height, margin } = this.bounds;
    const radius = type === 'avatar' ? this.avatarRadius : this.badgeRadius;

    // Calculate the safe zone where element centers can be placed
    // For X: allow avatars to be at line endpoints (chart area edge)
    // The margin.right already provides space for avatar + label
    // For Y: keep radius padding to prevent clipping at top/bottom
    const minX = (margin.left || 0);
    const maxX = width - (margin.right || 0);
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
      
      // If avatar is near right edge, switch label to left side
      // Use 50px threshold for label width
      let labelPosition = el.labelPosition;
      const labelThreshold = width - (margin.right || 0) - radius - 50;
      if (type === 'avatar' && currentX > labelThreshold) {
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
   * Compute bounds clamping as OFFSETS, preserving original x/y for line alignment.
   * This ensures avatars render at line endpoints, with offsets applied only when needed.
   * @param {Array} elements - Elements with x, y
   * @param {'avatar'|'badge'} type - Element type
   * @returns {Array} Elements with _clampOffsetX/_clampOffsetY computed
   */
  _clampBasePositions(elements, type) {
    const { width, height, margin } = this.bounds;
    const radius = type === 'avatar' ? this.avatarRadius : this.badgeRadius;

    // Calculate the safe zone where element centers can be placed
    // For X: allow avatars to be at line endpoints (chart area edge)
    // The margin.right already provides space for avatar + label
    // For Y: keep radius padding to prevent clipping at top/bottom
    const minX = (margin.left || 0);
    const maxX = width - (margin.right || 0);
    const minY = (margin.top || 0) + radius;
    const maxY = height - (margin.bottom || 0) - radius;
    
    return elements.map(el => {
      const originalX = el.x;
      const originalY = el.y;
      
      // Compute clamped position
      const clampedX = Math.max(minX, Math.min(maxX, originalX));
      const clampedY = Math.max(minY, Math.min(maxY, originalY));
      
      // Calculate offset needed (negative = move left)
      const clampOffsetX = clampedX - originalX;
      const clampOffsetY = clampedY - originalY;
      
      const needsClamp = clampOffsetX !== 0 || clampOffsetY !== 0;
      
      if (!needsClamp) {
        return el; // No clamping needed, pass through unchanged
      }
      
      // If avatar is near right edge, switch label to left side
      // Use 50px threshold for label width
      let labelPosition = el.labelPosition;
      const labelThreshold = width - (margin.right || 0) - radius - 50;
      if (type === 'avatar' && originalX > labelThreshold) {
        labelPosition = 'left';
      }
      
      return {
        ...el,
        // PRESERVE original x/y - this is where the line endpoint is
        x: originalX,
        y: originalY,
        // Store clamp offset separately - will be merged into offsetX/Y later
        _clampOffsetX: clampOffsetX,
        _clampOffsetY: clampOffsetY,
        labelPosition,
        _baseClamped: true // Debug flag
      };
    });
  }

  /**
   * Resolve avatar collisions by moving lower avatars left.
   * Higher avatars (lower Y) stay anchored at line endpoints.
   * No vertical displacement - only horizontal.
   */
  _resolveAvatarCollisionsHorizontal(avatars) {
    if (avatars.length < 2) {
      return avatars.map(a => ({
        ...a,
        offsetX: a._clampOffsetX || 0,
        offsetY: a._clampOffsetY || 0
      }));
    }

    const minDist = this.avatarRadius * 2; // Minimum distance between centers

    // Sort by Y ascending (top/higher avatars first - they have priority)
    const sorted = [...avatars].sort((a, b) => {
      const ay = a.y + (a._clampOffsetY || 0);
      const by = b.y + (b._clampOffsetY || 0);
      return ay - by;
    });

    // Track final positions (x offset from original position)
    const offsets = sorted.map(a => ({
      avatar: a,
      offsetX: a._clampOffsetX || 0,
      offsetY: a._clampOffsetY || 0
    }));

    // For each avatar (starting from second), check collisions with all higher avatars
    for (let i = 1; i < sorted.length; i++) {
      const current = offsets[i];
      const currY = current.avatar.y + current.offsetY;

      // Check against all avatars above this one
      for (let j = 0; j < i; j++) {
        const other = offsets[j];
        const otherY = other.avatar.y + other.offsetY;

        // Calculate current positions
        const currX = current.avatar.x + current.offsetX;
        const otherX = other.avatar.x + other.offsetX;

        // Check for collision
        const dx = currX - otherX;
        const dy = currY - otherY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < minDist) {
          // Move current avatar left to resolve collision
          // Calculate how much to move left to clear the collision vertically
          const verticalGap = Math.abs(dy);
          if (verticalGap < minDist) {
            // Need horizontal displacement
            const neededHorizontalGap = Math.sqrt(minDist * minDist - dy * dy);
            const currentHorizontalGap = Math.abs(dx);
            if (currentHorizontalGap < neededHorizontalGap) {
              // Move left by the difference plus some padding
              current.offsetX -= (neededHorizontalGap - currentHorizontalGap + 4);
            }
          }
        }
      }
    }

    // Return avatars with computed offsets
    return offsets.map(({ avatar, offsetX, offsetY }) => ({
      ...avatar,
      offsetX,
      offsetY
    }));
  }
}
