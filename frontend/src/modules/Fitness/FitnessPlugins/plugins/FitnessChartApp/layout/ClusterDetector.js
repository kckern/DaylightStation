export class ClusterDetector {
  constructor(config = {}) {
    this.clusterThreshold = config.clusterThreshold || 90; // 3 * radius (30)
  }

  detectClusters(elements) {
    if (!elements || elements.length === 0) return [];

    console.log('[ClusterDetector] Input elements:', elements.length, 'threshold:', this.clusterThreshold);

    // Sort by Y for easier clustering
    const sorted = [...elements].sort((a, b) => a.y - b.y);
    const clusters = [];
    let currentCluster = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const prev = currentCluster[currentCluster.length - 1];
      const yDiff = Math.abs(current.y - prev.y);
      
      // Simple 1D clustering on Y axis for now (assuming similar X)
      // This matches the "Current Zone" logic where X is identical
      if (yDiff <= this.clusterThreshold) {
        currentCluster.push(current);
        console.log('[ClusterDetector] Adding to cluster, yDiff:', yDiff);
      } else {
        clusters.push(currentCluster);
        currentCluster = [current];
        console.log('[ClusterDetector] New cluster, yDiff:', yDiff);
      }
    }
    clusters.push(currentCluster);

    console.log('[ClusterDetector] Clusters:', clusters.map(c => c.length));
    return clusters;
  }
}
