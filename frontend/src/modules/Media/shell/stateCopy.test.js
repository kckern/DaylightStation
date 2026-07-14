// frontend/src/modules/Media/shell/stateCopy.test.js
import { describe, it, expect } from 'vitest';
import { playbackStateLabel, deviceStateLabel, remoteStatusLine } from './stateCopy.js';

describe('playbackStateLabel', () => {
  it('humanizes engine states', () => {
    expect(playbackStateLabel('playing')).toBe('Playing');
    expect(playbackStateLabel('paused')).toBe('Paused');
    expect(playbackStateLabel('buffering')).toBe('Buffering…');
    expect(playbackStateLabel('stalled')).toBe('Having trouble streaming — hang on');
    expect(playbackStateLabel('idle')).toBe('Nothing playing');
    expect(playbackStateLabel('stopped')).toBe('Nothing playing');
  });

  it('never leaks a raw state for unknowns', () => {
    expect(playbackStateLabel('unknown')).toBe('');
    expect(playbackStateLabel(undefined)).toBe('');
  });
});

describe('deviceStateLabel', () => {
  it('humanizes device states', () => {
    expect(deviceStateLabel('playing')).toBe('Playing');
    expect(deviceStateLabel('paused')).toBe('Paused');
    expect(deviceStateLabel('idle')).toBe('Idle');
    expect(deviceStateLabel('stopped')).toBe('Idle');
  });

  it('says "Not reporting" instead of "unknown"', () => {
    expect(deviceStateLabel('unknown')).toBe('Not reporting');
    expect(deviceStateLabel(undefined)).toBe('Not reporting');
  });

  it('describes offline devices by their last-seen activity', () => {
    expect(deviceStateLabel('playing', { offline: true })).toBe('Off — last seen playing');
    expect(deviceStateLabel('paused', { offline: true })).toBe('Off — last seen paused');
    expect(deviceStateLabel('unknown', { offline: true })).toBe('Off');
    expect(deviceStateLabel('idle', { offline: true })).toBe('Off');
  });
});

describe('remoteStatusLine', () => {
  it('reads naturally with a title', () => {
    expect(remoteStatusLine('playing', 'Frozen')).toBe('Playing Frozen');
    expect(remoteStatusLine('paused', 'Frozen')).toBe('Paused — Frozen');
  });

  it('never shows "nothing" or "unknown" raw', () => {
    expect(remoteStatusLine('unknown', null)).toBe('Nothing playing right now');
    expect(remoteStatusLine(undefined, undefined)).toBe('Nothing playing right now');
    expect(remoteStatusLine('idle', 'Frozen')).toBe('Nothing playing right now');
  });

  it('falls back to the bare title when state is unknown but an item exists', () => {
    expect(remoteStatusLine('unknown', 'Frozen')).toBe('Frozen');
  });
});
