// watchLog.test.js
import { describe, it, expect } from 'vitest';
import { buildWatchLogPayload } from './watchLog.js';

describe('buildWatchLogPayload', () => {
  it('computes percent and in_progress status mid-video', () => {
    const p = buildWatchLogPayload({ contentId: 'plex:9', title: 'L1', seconds: 30, duration: 120, reason: 'progress' });
    expect(p).toMatchObject({
      title: 'L1', type: 'plex', assetId: 'plex:9',
      seconds: 30, percent: 25, status: 'in_progress', naturalEnd: false,
      duration: 120, reason: 'progress',
    });
  });
  it('marks completed/naturalEnd at >=98%', () => {
    const p = buildWatchLogPayload({ contentId: 'plex:9', seconds: 119, duration: 120, reason: 'close' });
    expect(p.status).toBe('completed');
    expect(p.naturalEnd).toBe(true);
  });
  it('handles missing duration as none/0%', () => {
    const p = buildWatchLogPayload({ contentId: 'plex:9', seconds: 0, duration: 0, reason: 'close' });
    expect(p).toMatchObject({ percent: 0, status: 'none', naturalEnd: false });
  });
  it('omits userId/engaged when not supplied', () => {
    const p = buildWatchLogPayload({ contentId: 'plex:9', seconds: 30, duration: 120, reason: 'progress' });
    expect(p).not.toHaveProperty('userId');
    expect(p).not.toHaveProperty('engaged');
  });
  it('includes userId and engaged when supplied', () => {
    const p = buildWatchLogPayload({ contentId: 'plex:9', seconds: 30, duration: 120, reason: 'progress', userId: 'user_3', engaged: true });
    expect(p).toMatchObject({ userId: 'user_3', engaged: true });
  });
});

describe('buildWatchLogPayload practice', () => {
  it('carries practice only when given', async () => {
    const { buildWatchLogPayload: build } = await import('./watchLog.js');
    const base = { contentId: 'plex:1', seconds: 50, duration: 100 };
    expect(build(base).practice).toBeUndefined();
    const practice = { sittingId: 'a', humanNotes: 3, practiceNotes: 2, playedSec: 40, drillsPassed: 0 };
    expect(build({ ...base, practice }).practice).toEqual(practice);
  });
});
