import { describe, it, expect } from 'vitest';
import { deviceName, deviceIcon, deviceLocation, displayDeviceName, isMachineDeviceLabel } from './deviceDisplay.js';

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

describe('displayDeviceName — no hash ever reaches the UI', () => {
  it('passes a real name through', () => {
    expect(displayDeviceName('Kitchen iPad')).toBe('Kitchen iPad');
    expect(displayDeviceName('  Mac ')).toBe('Mac');
  });
  it('reads "a browser" for a made-up or missing name', () => {
    expect(displayDeviceName('Browser 4778f429')).toBe('a browser');
    expect(displayDeviceName('browser:4778f429aa11')).toBe('a browser');
    expect(displayDeviceName('')).toBe('a browser');
    expect(displayDeviceName(null)).toBe('a browser');
  });
  it('takes a caller fallback (the viewer\'s own browser is "this device")', () => {
    expect(displayDeviceName('Browser 4778f429', { fallback: 'this device' })).toBe('this device');
  });
  it('recognises machine labels', () => {
    expect(isMachineDeviceLabel('Browser 1a2b3c4d')).toBe(true);
    expect(isMachineDeviceLabel('ephemeral:abcd1234')).toBe(true);
    expect(isMachineDeviceLabel('4778f429-aa11-4b2c')).toBe(true);
    expect(isMachineDeviceLabel('Browser Room')).toBe(false);
    expect(isMachineDeviceLabel('Office TV')).toBe(false);
  });
  it('deviceName never humanizes a browser id into a hash', () => {
    expect(deviceName({ id: 'browser:4778f429aa11' })).toBe('a browser');
    expect(deviceName({ id: 'browser:4778f429aa11', name: 'Browser 4778f429' })).toBe('a browser');
    expect(deviceName({ id: 'browser:4778f429aa11', name: 'Dad phone' })).toBe('Dad phone');
  });
});
