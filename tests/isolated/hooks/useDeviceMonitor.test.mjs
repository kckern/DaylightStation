// tests/isolated/hooks/useDeviceMonitor.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Pure function imports (no React needed) ────────────────────────

let playbackPredicate, extractId, purgeStale, EXPIRY_MS;

beforeEach(async () => {
  const mod = await import('#frontend/hooks/media/useDeviceMonitor.js');
  playbackPredicate = mod.playbackPredicate;
  extractId = mod.extractId;
  purgeStale = mod.purgeStale;
  EXPIRY_MS = mod.EXPIRY_MS;
});

// ── Test: playbackPredicate ────────────────────────────────────────

describe('playbackPredicate', () => {
  it('returns true for messages with topic starting with "playback:"', () => {
    expect(playbackPredicate({ topic: 'playback:state' })).toBe(true);
    expect(playbackPredicate({ topic: 'playback:started' })).toBe(true);
    expect(playbackPredicate({ topic: 'playback:stopped' })).toBe(true);
    expect(playbackPredicate({ topic: 'playback:' })).toBe(true);
  });

  it('returns false for messages with non-playback topics', () => {
    expect(playbackPredicate({ topic: 'fitness:heartrate' })).toBe(false);
    expect(playbackPredicate({ topic: 'device:online' })).toBe(false);
    expect(playbackPredicate({ topic: 'media:queue' })).toBe(false);
  });

  it('returns false when topic is missing or undefined', () => {
    expect(playbackPredicate({})).toBeFalsy();
    expect(playbackPredicate({ type: 'playback:state' })).toBeFalsy();
    expect(playbackPredicate({ topic: null })).toBeFalsy();
  });

  it('returns false for topic "playback" without colon', () => {
    expect(playbackPredicate({ topic: 'playback' })).toBe(false);
  });

  it('returns false for topic that contains but does not start with "playback:"', () => {
    expect(playbackPredicate({ topic: 'some:playback:thing' })).toBe(false);
  });
});

// ── Test: extractId ────────────────────────────────────────────────

describe('extractId', () => {
  it('returns deviceId when present', () => {
    expect(extractId({ deviceId: 'living-room-tv', clientId: 'abc123' })).toBe('living-room-tv');
  });

  it('falls back to clientId when deviceId is absent', () => {
    expect(extractId({ clientId: 'browser-xyz' })).toBe('browser-xyz');
  });

  it('prefers deviceId over clientId', () => {
    expect(extractId({ deviceId: 'shield-tv', clientId: 'client-1' })).toBe('shield-tv');
  });

  it('returns null when neither deviceId nor clientId is present', () => {
    expect(extractId({})).toBeNull();
    expect(extractId({ topic: 'playback:state' })).toBeNull();
  });

  it('falls back to clientId when deviceId is falsy', () => {
    expect(extractId({ deviceId: null, clientId: 'abc' })).toBe('abc');
    expect(extractId({ deviceId: '', clientId: 'abc' })).toBe('abc');
  });
});

// ── Test: purgeStale ───────────────────────────────────────────────

describe('purgeStale', () => {
  it('removes entries older than expiryMs and returns their ids', () => {
    const timestamps = new Map([
      ['device-a', 1000],
      ['device-b', 500],
      ['device-c', 29000],
    ]);

    const expired = purgeStale(timestamps, 31001, 30000);

    expect(expired).toEqual(['device-a', 'device-b']);
    expect(timestamps.has('device-a')).toBe(false);
    expect(timestamps.has('device-b')).toBe(false);
    expect(timestamps.has('device-c')).toBe(true);
  });

  it('returns empty array when no entries are stale', () => {
    const timestamps = new Map([
      ['device-a', 50000],
      ['device-b', 55000],
    ]);

    const expired = purgeStale(timestamps, 60000, 30000);

    expect(expired).toEqual([]);
    expect(timestamps.size).toBe(2);
  });

  it('handles empty map', () => {
    const timestamps = new Map();
    const expired = purgeStale(timestamps, 100000, 30000);
    expect(expired).toEqual([]);
  });

  it('removes all entries when all are stale', () => {
    const timestamps = new Map([
      ['a', 0],
      ['b', 100],
    ]);

    const expired = purgeStale(timestamps, 50000, 30000);

    expect(expired).toHaveLength(2);
    expect(timestamps.size).toBe(0);
  });

  it('does not remove entries at exactly the expiry boundary', () => {
    const timestamps = new Map([
      ['edge', 10000],
    ]);

    // now - ts === expiryMs (exactly 30000), which is NOT > expiryMs
    const expired = purgeStale(timestamps, 40000, 30000);

    expect(expired).toEqual([]);
    expect(timestamps.has('edge')).toBe(true);
  });
});

// ── Test: EXPIRY_MS constant ───────────────────────────────────────

describe('EXPIRY_MS', () => {
  it('is 30000ms (30 seconds)', () => {
    expect(EXPIRY_MS).toBe(30000);
  });
});

// ── Test: expiry sweep integration (setInterval simulation) ────────

describe('expiry sweep behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('purges stale entries after 30s of inactivity', () => {
    const timestamps = new Map();
    const playbackStates = new Map();

    // Simulate receiving a message at t=0
    const now0 = Date.now();
    timestamps.set('device-a', now0);
    playbackStates.set('device-a', { topic: 'playback:state', deviceId: 'device-a', state: 'playing' });

    // Set up a sweep interval like the hook does
    const sweepInterval = setInterval(() => {
      const now = Date.now();
      const expired = purgeStale(timestamps, now, EXPIRY_MS);
      expired.forEach(id => playbackStates.delete(id));
    }, 10000);

    // At t=10s: not expired yet
    vi.advanceTimersByTime(10000);
    expect(playbackStates.has('device-a')).toBe(true);

    // At t=20s: still not expired
    vi.advanceTimersByTime(10000);
    expect(playbackStates.has('device-a')).toBe(true);

    // At t=30s: exactly at boundary, not expired (> not >=)
    vi.advanceTimersByTime(10000);
    expect(playbackStates.has('device-a')).toBe(true);

    // At t=40s: expired (now - ts = 40000 > 30000)
    vi.advanceTimersByTime(10000);
    expect(playbackStates.has('device-a')).toBe(false);
    expect(timestamps.has('device-a')).toBe(false);

    clearInterval(sweepInterval);
  });

  it('keeps entries alive when they receive fresh updates', () => {
    const timestamps = new Map();
    const playbackStates = new Map();

    const sweepInterval = setInterval(() => {
      const now = Date.now();
      const expired = purgeStale(timestamps, now, EXPIRY_MS);
      expired.forEach(id => playbackStates.delete(id));
    }, 10000);

    // Receive initial message at t=0
    timestamps.set('device-a', Date.now());
    playbackStates.set('device-a', { state: 'playing', position: 0 });

    // At t=20s: update the timestamp (simulates new WS message)
    vi.advanceTimersByTime(20000);
    timestamps.set('device-a', Date.now());
    playbackStates.set('device-a', { state: 'playing', position: 20 });

    // At t=40s: only 20s since last update, should still be alive
    vi.advanceTimersByTime(20000);
    expect(playbackStates.has('device-a')).toBe(true);

    // At t=60s: 40s since last update at t=20s, should be expired
    vi.advanceTimersByTime(20000);
    expect(playbackStates.has('device-a')).toBe(false);

    clearInterval(sweepInterval);
  });
});

// ── Test: module exports ───────────────────────────────────────────

describe('module exports', () => {
  it('exports useDeviceMonitor as named and default', async () => {
    const mod = await import('#frontend/hooks/media/useDeviceMonitor.js');
    expect(typeof mod.useDeviceMonitor).toBe('function');
    expect(typeof mod.default).toBe('function');
    expect(mod.useDeviceMonitor).toBe(mod.default);
  });

  it('exports playbackPredicate, extractId, purgeStale, and EXPIRY_MS', async () => {
    const mod = await import('#frontend/hooks/media/useDeviceMonitor.js');
    expect(typeof mod.playbackPredicate).toBe('function');
    expect(typeof mod.extractId).toBe('function');
    expect(typeof mod.purgeStale).toBe('function');
    expect(typeof mod.EXPIRY_MS).toBe('number');
  });
});
