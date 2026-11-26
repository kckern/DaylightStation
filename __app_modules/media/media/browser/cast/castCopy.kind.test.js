// RELY.2a/AC3 — progress wording fits the kind of screen.
import { describe, it, expect } from 'vitest';
import { friendlyStepLabel, deviceKind } from "./castCopy.js";

describe('step wording by screen kind', () => {
  it('derives a kind from configured type or icon', () => {
    expect(deviceKind({ type: 'shield-tv' })).toBe('tv');
    expect(deviceKind({ icon: 'tv' })).toBe('tv');
    expect(deviceKind({ type: 'speaker' })).toBe('speaker');
    expect(deviceKind({ type: 'speaker-lane' })).toBe('speaker');
    expect(deviceKind({ type: 'android-tablet' })).toBe('screen');
    expect(deviceKind(null)).toBe('screen');
  });

  it('never says TV for a speaker or a generic screen', () => {
    expect(friendlyStepLabel('power', 'tv')).toBe('Turning on TV…');
    for (const kind of ['speaker', 'screen']) {
      for (const step of ['power', 'verify', 'volume', 'prepare', 'prewarm', 'load', 'playback']) {
        expect(friendlyStepLabel(step, kind)).not.toMatch(/\bTV\b/);
      }
    }
    expect(friendlyStepLabel('power', 'speaker')).toBe('Waking the speaker…');
  });
});

import { pickerStatus } from './castCopy.js';
import { deviceGlyph } from '../fleet/deviceDisplay.js';

describe('pickerStatus — one status word on every picker row', () => {
  it('reads Ready for a screen that never reported, Off when offline, the title when busy', () => {
    expect(pickerStatus(null).text).toBe('Ready');
    expect(pickerStatus({ snapshot: { state: 'idle' } }).text).toBe('Ready');
    expect(pickerStatus({ offline: true, snapshot: { state: 'idle' } }).text).toBe('Off');
    expect(pickerStatus({ snapshot: { state: 'paused', currentItem: { title: 'Sonic' } } }).text).toBe('Paused: Sonic');
    expect(pickerStatus({ snapshot: { state: 'playing', position: 10, currentItem: { title: 'Sonic', duration: 100 } } }).text).toBe('Playing: Sonic');
  });
});

describe('deviceGlyph — the kind of device, never the configured emoji', () => {
  it('maps hardware types and browsers', () => {
    expect(deviceGlyph({ type: 'shield-tv', icon: '📺' })).toBe('tv');
    expect(deviceGlyph({ type: 'linux-pc', icon: '🖥️' })).toBe('desktop');
    expect(deviceGlyph({ type: 'android-tablet', icon: '🎹' })).toBe('tablet');
    expect(deviceGlyph({ type: 'speaker' })).toBe('speaker');
    expect(deviceGlyph({ id: 'browser:abc', type: 'browser' })).toBe('browser');
    expect(deviceGlyph({ type: 'unknown' })).toBe('desktop');
  });
});
