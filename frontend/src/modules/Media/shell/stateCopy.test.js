// frontend/src/modules/Media/shell/stateCopy.test.js
import { describe, it, expect } from 'vitest';
import {
  playbackStateLabel,
  deviceStateLabel,
  remoteStatusLine,
  queuePositionLabel,
  playbackRateLabel,
} from './stateCopy.js';

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

describe('queuePositionLabel', () => {
  it('formats a 1-based position', () => {
    expect(queuePositionLabel(1, 3)).toBe('2 of 3');
    expect(queuePositionLabel(0, 2)).toBe('1 of 2');
  });

  it('returns null when there is nothing meaningful to say', () => {
    expect(queuePositionLabel(0, 1)).toBeNull(); // single item
    expect(queuePositionLabel(-1, 5)).toBeNull(); // no current item
    expect(queuePositionLabel(2, 2)).toBeNull(); // out of range
    expect(queuePositionLabel(null, 3)).toBeNull();
    expect(queuePositionLabel(0.5, 3)).toBeNull();
  });
});

describe('playbackRateLabel', () => {
  it('formats speeds compactly', () => {
    expect(playbackRateLabel(1)).toBe('1×');
    expect(playbackRateLabel(1.25)).toBe('1.25×');
    expect(playbackRateLabel(1.5)).toBe('1.5×');
    expect(playbackRateLabel(2)).toBe('2×');
    expect(playbackRateLabel(0.75)).toBe('0.75×');
  });

  it('never shows NaN or nonsense', () => {
    expect(playbackRateLabel(NaN)).toBe('1×');
    expect(playbackRateLabel(0)).toBe('1×');
    expect(playbackRateLabel(undefined)).toBe('1×');
  });
});
