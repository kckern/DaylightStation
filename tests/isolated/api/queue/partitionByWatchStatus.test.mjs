import { describe, it, expect } from 'vitest';
import { QueueService } from '../../../../backend/src/2_domains/content/services/QueueService.mjs';

describe('partitionByWatchStatus', () => {
  const classifier = {
    classify: (progress) => {
      if (!progress || !progress.playhead) return 'unwatched';
      if (progress.percent >= 90) return 'watched';
      return 'in_progress';
    }
  };

  it('should put items with no progress in unwatched', () => {
    const items = [{ id: 'plex:1' }, { id: 'plex:2' }];
    const progressMap = new Map();
    const { unwatched, watched } = QueueService.partitionByWatchStatus(items, progressMap, classifier);
    expect(unwatched).toHaveLength(2);
    expect(watched).toHaveLength(0);
  });

  it('should partition watched items to the end', () => {
    const items = [{ id: 'plex:1' }, { id: 'plex:2' }, { id: 'plex:3' }];
    const progressMap = new Map([
      ['plex:1', { playhead: 280, duration: 280, percent: 100, playCount: 5 }],
      ['plex:3', { playhead: 250, duration: 280, percent: 89, playCount: 1 }]
    ]);
    const { unwatched, watched } = QueueService.partitionByWatchStatus(items, progressMap, classifier);
    expect(unwatched.map(i => i.id)).toEqual(['plex:2', 'plex:3']);
    expect(watched.map(i => i.id)).toEqual(['plex:1']);
  });

  it('should treat in_progress as unwatched', () => {
    const items = [{ id: 'plex:1' }];
    const progressMap = new Map([
      ['plex:1', { playhead: 50, duration: 280, percent: 18, playCount: 1, watchTime: 120 }]
    ]);
    const { unwatched, watched } = QueueService.partitionByWatchStatus(items, progressMap, classifier);
    expect(unwatched).toHaveLength(1);
    expect(watched).toHaveLength(0);
  });
});
