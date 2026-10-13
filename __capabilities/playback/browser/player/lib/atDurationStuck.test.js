import { describe, it, expect } from 'vitest';
import { shouldLogAtDurationStuck, buildAtDurationStuckPayload } from './atDurationStuck.js';

describe('shouldLogAtDurationStuck', () => {
  const baseEl = {
    ended: false,
    duration: 441.76,
    currentTime: 441.76,
    paused: true,
    seeking: true,
    readyState: 4,
    networkState: 2
  };

  it('returns true when the element is paused within 0.5s of duration and not ended', () => {
    expect(shouldLogAtDurationStuck({
      hasEnded: false,
      mediaEl: baseEl,
      alreadyLogged: false
    })).toBe(true);
  });

  it('returns true at exactly duration - 0.5', () => {
    expect(shouldLogAtDurationStuck({
      hasEnded: false,
      mediaEl: { ...baseEl, currentTime: 441.26 },
      alreadyLogged: false
    })).toBe(true);
  });

  it('returns false just outside the threshold', () => {
    expect(shouldLogAtDurationStuck({
      hasEnded: false,
      mediaEl: { ...baseEl, currentTime: 441.25 },
      alreadyLogged: false
    })).toBe(false);
  });

  it('returns false when mediaEl.ended is true (legitimate natural end)', () => {
    expect(shouldLogAtDurationStuck({
      hasEnded: false,
      mediaEl: { ...baseEl, ended: true },
      alreadyLogged: false
    })).toBe(false);
  });

  it('returns false when controller already saw ended', () => {
    expect(shouldLogAtDurationStuck({
      hasEnded: true,
      mediaEl: baseEl,
      alreadyLogged: false
    })).toBe(false);
  });

  it('returns false when already logged for this episode', () => {
    expect(shouldLogAtDurationStuck({
      hasEnded: false,
      mediaEl: baseEl,
      alreadyLogged: true
    })).toBe(false);
  });

  it('returns false on missing or zero duration', () => {
    expect(shouldLogAtDurationStuck({
      hasEnded: false,
      mediaEl: { ...baseEl, duration: 0 },
      alreadyLogged: false
    })).toBe(false);
    expect(shouldLogAtDurationStuck({
      hasEnded: false,
      mediaEl: { ...baseEl, duration: NaN },
      alreadyLogged: false
    })).toBe(false);
  });

  it('returns false on missing mediaEl', () => {
    expect(shouldLogAtDurationStuck({
      hasEnded: false,
      mediaEl: null,
      alreadyLogged: false
    })).toBe(false);
  });
});

describe('buildAtDurationStuckPayload', () => {
  it('serializes the witness state for the audit incident', () => {
    const payload = buildAtDurationStuckPayload({
      assetId: 'plex:59518',
      mediaEl: {
        currentTime: 441.759999,
        duration: 441.759999,
        paused: true,
        seeking: true,
        readyState: 4,
        networkState: 2
      }
    });
    expect(payload).toEqual({
      mediaKey: 'plex:59518',
      currentTime: 441.759999,
      duration: 441.759999,
      paused: true,
      seeking: true,
      readyState: 4,
      networkState: 2
    });
  });
});
