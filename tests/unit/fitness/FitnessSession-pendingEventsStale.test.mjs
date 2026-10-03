import { describe, it, expect, jest, beforeAll } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

/**
 * Events logged while no timeline exists are queued and flushed into the next
 * session's timeline. The queue only bridges the few seconds between the pre-session
 * buffer filling and the timeline being built. An event from long before that — e.g.
 * the media-end of a video closed after the previous session already ended — must
 * not be flushed into a later, unrelated session (2026-10-02: session
 * 20261002145033 inherited plex:664043's close from 6 minutes earlier and read as
 * a duplicate of the real workout).
 */
let FitnessSession;

beforeAll(async () => {
  ({ FitnessSession } = await import('#frontend/hooks/fitness/FitnessSession.js'));
});

describe('FitnessSession pending-event flush', () => {
  it('flushes recent queued events and drops stale ones', () => {
    const session = new FitnessSession();
    const now = Date.now();
    session.logEvent('media', { contentId: 'plex:stale' }, now - 6 * 60 * 1000);
    session.logEvent('media', { contentId: 'plex:fresh' }, now - 2000);

    expect(session.ensureStarted({ reason: 'test', force: true })).toBe(true);

    const ids = session.timeline.events.map((e) => e.data?.contentId);
    expect(ids).toContain('plex:fresh');
    expect(ids).not.toContain('plex:stale');
  });
});
