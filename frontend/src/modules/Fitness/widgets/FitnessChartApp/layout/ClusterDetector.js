export class ClusterDetector {
  constructor(config = {}) {
    // Collision threshold: avatars collide if centers are closer than 2*radius
    this.collisionThreshold = config.collisionThreshold || config.clusterThreshold || 60;
  }

  detectClusters(elements) {
    if (!elements || elements.length === 0) return [];
    if (elements.length === 1) return [[elements[0]]];

    // Use union-find to group colliding avatars
    const parent = elements.map((_, i) => i);
    const find = (i) => {
      if (parent[i] !== i) parent[i] = find(parent[i]);
      return parent[i];
    };
    const union = (i, j) => {
      const pi = find(i), pj = find(j);
      if (pi !== pj) parent[pi] = pj;
    };

    // Check all pairs for actual collision (2D distance)
    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const a = elements[i], b = elements[j];
        const dx = (a.x + (a._clampOffsetX || 0)) - (b.x + (b._clampOffsetX || 0));
        const dy = (a.y + (a._clampOffsetY || 0)) - (b.y + (b._clampOffsetY || 0));
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.collisionThreshold) {
          union(i, j);
        }
      }
    }

    // Group by cluster root
    const groups = {};
    elements.forEach((el, i) => {
      const root = find(i);
      if (!groups[root]) groups[root] = [];
      groups[root].push(el);
    });

    return Object.values(groups);
  }
}
