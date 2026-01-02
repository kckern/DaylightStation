import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ClusterDetector } from '../ClusterDetector.js';

describe('ClusterDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new ClusterDetector({ clusterThreshold: 90 });
  });

  it('should return empty array for empty input', () => {
    const clusters = detector.detectClusters([]);
    assert.equal(clusters.length, 0);
  });

  it('should group single element into one cluster', () => {
    const elements = [{ id: '1', y: 100 }];
    const clusters = detector.detectClusters(elements);
    
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].length, 1);
  });

  it('should group close elements together', () => {
    const elements = [
      { id: '1', y: 100 },
      { id: '2', y: 150 } // diff 50 <= 90
    ];
    const clusters = detector.detectClusters(elements);
    
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].length, 2);
  });

  it('should separate distant elements', () => {
    const elements = [
      { id: '1', y: 100 },
      { id: '2', y: 200 } // diff 100 > 90
    ];
    const clusters = detector.detectClusters(elements);
    
    assert.equal(clusters.length, 2);
    assert.equal(clusters[0].length, 1);
    assert.equal(clusters[1].length, 1);
  });
});
