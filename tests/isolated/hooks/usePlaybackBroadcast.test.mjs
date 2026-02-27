// tests/isolated/hooks/usePlaybackBroadcast.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Pure function imports (no React needed) ────────────────────────

let buildBroadcastMessage, buildStopMessage, BROADCAST_INTERVAL_MS;

beforeEach(async () => {
  const mod = await import('#frontend/hooks/media/usePlaybackBroadcast.js');
  buildBroadcastMessage = mod.buildBroadcastMessage;
  buildStopMessage = mod.buildStopMessage;
  BROADCAST_INTERVAL_MS = mod.BROADCAST_INTERVAL_MS;
});

// ── Test: buildBroadcastMessage ────────────────────────────────────

describe('buildBroadcastMessage', () => {
  const identity = { clientId: 'abc12345', deviceId: null, displayName: 'Chrome on Mac' };

  it('returns a playback_state message when element is playing', () => {
    const mediaEl = { paused: false, currentTime: 42.7, duration: 180.3 };
    const playerRef = { current: { getMediaElement: () => mediaEl } };
    const item = { contentId: 'song:123', title: 'Test Song', format: 'audio', thumbnail: '/img.jpg' };

    const msg = buildBroadcastMessage(playerRef, item, identity);

    expect(msg).not.toBeNull();
    expect(msg.topic).toBe('playback_state');
    expect(msg.state).toBe('playing');
    expect(msg.clientId).toBe('abc12345');
    expect(msg.deviceId).toBeNull();
    expect(msg.displayName).toBe('Chrome on Mac');
    expect(msg.contentId).toBe('song:123');
    expect(msg.title).toBe('Test Song');
    expect(msg.format).toBe('audio');
    expect(msg.position).toBe(43); // Math.round(42.7)
    expect(msg.duration).toBe(180); // Math.round(180.3)
    expect(msg.thumbnail).toBe('/img.jpg');
  });

  it('returns null when media element is paused', () => {
    const mediaEl = { paused: true, currentTime: 10, duration: 60 };
    const playerRef = { current: { getMediaElement: () => mediaEl } };
    const item = { contentId: 'song:456', title: 'Paused Song', format: 'audio', thumbnail: null };

    const msg = buildBroadcastMessage(playerRef, item, identity);

    expect(msg).toBeNull();
  });

  it('returns null when getMediaElement returns null', () => {
    const playerRef = { current: { getMediaElement: () => null } };
    const item = { contentId: 'song:000', title: 'No Element', format: 'audio', thumbnail: null };

    const msg = buildBroadcastMessage(playerRef, item, identity);

    expect(msg).toBeNull();
  });

  it('returns null when playerRef.current is null', () => {
    const playerRef = { current: null };
    const item = { contentId: 'song:000', title: 'No Ref', format: 'audio', thumbnail: null };

    const msg = buildBroadcastMessage(playerRef, item, identity);

    expect(msg).toBeNull();
  });

  it('handles NaN duration gracefully (falls back to 0)', () => {
    const mediaEl = { paused: false, currentTime: 5, duration: NaN };
    const playerRef = { current: { getMediaElement: () => mediaEl } };
    const item = { contentId: 'live:stream', title: 'Live', format: 'video', thumbnail: null };

    const msg = buildBroadcastMessage(playerRef, item, identity);

    expect(msg).not.toBeNull();
    expect(msg.duration).toBe(0);
  });

  it('sets thumbnail to null when item has no thumbnail', () => {
    const mediaEl = { paused: false, currentTime: 0, duration: 100 };
    const playerRef = { current: { getMediaElement: () => mediaEl } };
    const item = { contentId: 'a:1', title: 'T', format: 'audio' };

    const msg = buildBroadcastMessage(playerRef, item, identity);

    expect(msg.thumbnail).toBeNull();
  });

  it('includes deviceId when present', () => {
    const kioskIdentity = { clientId: 'kiosk01', deviceId: 'living-room-tv', displayName: 'Shield TV' };
    const mediaEl = { paused: false, currentTime: 0, duration: 200 };
    const playerRef = { current: { getMediaElement: () => mediaEl } };
    const item = { contentId: 'vid:99', title: 'Movie', format: 'video', thumbnail: '/poster.jpg' };

    const msg = buildBroadcastMessage(playerRef, item, kioskIdentity);

    expect(msg.deviceId).toBe('living-room-tv');
  });
});

// ── Test: buildStopMessage ─────────────────────────────────────────

describe('buildStopMessage', () => {
  it('returns a stopped playback_state message with null content fields', () => {
    const identity = { clientId: 'abc12345', deviceId: null, displayName: 'Chrome on Mac' };

    const msg = buildStopMessage(identity);

    expect(msg.topic).toBe('playback_state');
    expect(msg.state).toBe('stopped');
    expect(msg.clientId).toBe('abc12345');
    expect(msg.contentId).toBeNull();
    expect(msg.title).toBeNull();
    expect(msg.format).toBeNull();
    expect(msg.position).toBe(0);
    expect(msg.duration).toBe(0);
    expect(msg.thumbnail).toBeNull();
  });
});

// ── Test: interval behavior (simulate setInterval + broadcast) ─────

describe('broadcast interval behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires broadcast every 5 seconds via setInterval', () => {
    const identity = { clientId: 'x', deviceId: null, displayName: 'Test' };
    const sends = [];
    let currentTime = 0;
    const mediaEl = { paused: false, get currentTime() { return currentTime; }, duration: 300 };
    const playerRef = { current: { getMediaElement: () => mediaEl } };
    const item = { contentId: 'song:1', title: 'Song', format: 'audio', thumbnail: null };

    // Simulate what useEffect sets up: setInterval calling broadcast
    const interval = setInterval(() => {
      const msg = buildBroadcastMessage(playerRef, item, identity);
      if (msg) sends.push(msg);
    }, BROADCAST_INTERVAL_MS);

    // No sends before first interval
    expect(sends).toHaveLength(0);

    // After 5s, one send
    vi.advanceTimersByTime(5000);
    expect(sends).toHaveLength(1);
    expect(sends[0].topic).toBe('playback_state');
    expect(sends[0].position).toBe(0);

    // Simulate playback advancing
    currentTime = 5;
    vi.advanceTimersByTime(5000);
    expect(sends).toHaveLength(2);
    expect(sends[1].position).toBe(5);

    // Third tick
    currentTime = 10;
    vi.advanceTimersByTime(5000);
    expect(sends).toHaveLength(3);
    expect(sends[2].position).toBe(10);

    clearInterval(interval);
  });

  it('skips broadcast when element becomes paused mid-interval', () => {
    const identity = { clientId: 'x', deviceId: null, displayName: 'Test' };
    const sends = [];
    const mediaEl = { paused: false, currentTime: 0, duration: 300 };
    const playerRef = { current: { getMediaElement: () => mediaEl } };
    const item = { contentId: 'song:2', title: 'Song2', format: 'audio', thumbnail: null };

    const interval = setInterval(() => {
      const msg = buildBroadcastMessage(playerRef, item, identity);
      if (msg) sends.push(msg);
    }, BROADCAST_INTERVAL_MS);

    // First tick: playing
    vi.advanceTimersByTime(5000);
    expect(sends).toHaveLength(1);

    // Pause playback
    mediaEl.paused = true;

    // Second tick: paused, should NOT send
    vi.advanceTimersByTime(5000);
    expect(sends).toHaveLength(1); // still 1

    // Resume
    mediaEl.paused = false;
    mediaEl.currentTime = 15;

    // Third tick: playing again
    vi.advanceTimersByTime(5000);
    expect(sends).toHaveLength(2);

    clearInterval(interval);
  });
});

// ── Test: BROADCAST_INTERVAL_MS constant ───────────────────────────

describe('BROADCAST_INTERVAL_MS', () => {
  it('is 5000ms', () => {
    expect(BROADCAST_INTERVAL_MS).toBe(5000);
  });
});

// ── Test: module exports ───────────────────────────────────────────

describe('module exports', () => {
  it('exports usePlaybackBroadcast as named and default', async () => {
    const mod = await import('#frontend/hooks/media/usePlaybackBroadcast.js');
    expect(typeof mod.usePlaybackBroadcast).toBe('function');
    expect(typeof mod.default).toBe('function');
    expect(mod.usePlaybackBroadcast).toBe(mod.default);
  });

  it('exports buildBroadcastMessage and buildStopMessage', async () => {
    const mod = await import('#frontend/hooks/media/usePlaybackBroadcast.js');
    expect(typeof mod.buildBroadcastMessage).toBe('function');
    expect(typeof mod.buildStopMessage).toBe('function');
  });
});
