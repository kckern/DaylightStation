import { describe, it, expect } from 'vitest';
import { buildFpsStatsPayload } from './fpsStatsPayload.js';

const baseSnapshot = {
  seconds: 107,
  duration: 441.76,
  currentMaxKbps: null,
  media: { title: 'Teasing', assetId: 'plex:59518' },
  isDash: true,
  shader: 'default'
};

describe('buildFpsStatsPayload', () => {
  it('returns the round-1-decimal currentTime and duration from the snapshot', () => {
    const out = buildFpsStatsPayload({ ...baseSnapshot, seconds: 107.234 });
    expect(out.currentTime).toBe(107.2);
    expect(out.duration).toBe(441.8);
  });

  it('reflects updated seconds when called with a fresh snapshot (the bug fix)', () => {
    // Audit §4.1: the original bug emitted the same currentTime forever
    // because the interval callback closed over `seconds` at effect-creation
    // time. Building the payload from a snapshot lets the caller pass the
    // latest ref value on each tick.
    const first = buildFpsStatsPayload(baseSnapshot);
    const later = buildFpsStatsPayload({ ...baseSnapshot, seconds: 441.7 });
    expect(first.currentTime).toBe(107);
    expect(later.currentTime).toBe(441.7);
  });

  it('passes through the bitrate cap', () => {
    expect(buildFpsStatsPayload({ ...baseSnapshot, currentMaxKbps: 5000 }).bitrateCapKbps).toBe(5000);
    expect(buildFpsStatsPayload(baseSnapshot).bitrateCapKbps).toBeNull();
  });

  it('threads estimatedFps from the options bag (component-side concern)', () => {
    expect(buildFpsStatsPayload(baseSnapshot, { estimatedFps: 30.5 }).estimatedFps).toBe(30.5);
    expect(buildFpsStatsPayload(baseSnapshot, { estimatedFps: 'supported' }).estimatedFps).toBe('supported');
    expect(buildFpsStatsPayload(baseSnapshot).estimatedFps).toBeNull();
  });

  it('preserves the asset key from any of three media-shape variants', () => {
    expect(buildFpsStatsPayload({ ...baseSnapshot, media: { assetId: 'a' } }).mediaKey).toBe('a');
    expect(buildFpsStatsPayload({ ...baseSnapshot, media: { key: 'k' } }).mediaKey).toBe('k');
    expect(buildFpsStatsPayload({ ...baseSnapshot, media: { plex: 'p' } }).mediaKey).toBe('p');
  });

  it('safe-handles missing or invalid snapshot', () => {
    const out = buildFpsStatsPayload({});
    expect(out.currentTime).toBeNull();
    expect(out.duration).toBeNull();
    expect(out.bitrateCapKbps).toBeNull();
    expect(out.isDash).toBe(false);
  });
});
