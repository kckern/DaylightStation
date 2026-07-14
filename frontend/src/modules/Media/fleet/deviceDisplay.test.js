import { describe, it, expect } from 'vitest';
import { deviceName, deviceIcon, deviceLocation } from './deviceDisplay.js';

describe('deviceName', () => {
  it('prefers the configured name', () => {
    expect(deviceName({ id: 'livingroom-tv', name: 'Living Room TV' })).toBe('Living Room TV');
  });
  it('humanizes kebab ids when no name is configured', () => {
    expect(deviceName({ id: 'livingroom-tv' })).toBe('Living Room TV');
    expect(deviceName({ id: 'office-tv' })).toBe('Office TV');
    expect(deviceName({ id: 'yellow-room-tablet' })).toBe('Yellow Room Tablet');
    expect(deviceName({ id: 'garage-tv' })).toBe('Garage TV');
  });
  it('accepts a fallback id when device is null', () => {
    expect(deviceName(null, 'kitchen-pc')).toBe('Kitchen PC');
  });
  it('never returns an empty string', () => {
    expect(deviceName(null)).toBe('Unknown device');
    expect(deviceName({ name: '   ' }, '')).toBe('Unknown device');
  });
});

describe('deviceIcon', () => {
  it('prefers the configured icon', () => {
    expect(deviceIcon({ icon: '🎹', type: 'shield-tv' })).toBe('🎹');
  });
  it('falls back to a type default, then generic', () => {
    expect(deviceIcon({ type: 'linux-pc' })).toBe('🖥️');
    expect(deviceIcon({ type: 'android-tablet' })).toBe('📱');
    expect(deviceIcon({ type: 'something-new' })).toBe('📺');
    expect(deviceIcon(null)).toBe('📺');
  });
});

describe('deviceLocation', () => {
  it('returns configured location or empty string', () => {
    expect(deviceLocation({ location: 'Living Room' })).toBe('Living Room');
    expect(deviceLocation({})).toBe('');
    expect(deviceLocation(null)).toBe('');
  });
});
