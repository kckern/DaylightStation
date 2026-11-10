import { describe, it, expect } from 'vitest';
import { QueueService } from './QueueService.mjs';

describe('QueueService.isWatched — skipped', () => {
  it('a skipped item counts as done even at 1%', () => {
    expect(QueueService.isWatched({ percent: 1, duration: 3000, skipped: true })).toBe(true);
  });
  it('an unskipped 1% item is not done', () => {
    expect(QueueService.isWatched({ percent: 1, duration: 3000 })).toBe(false);
  });
});
