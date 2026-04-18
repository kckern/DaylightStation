import { describe, it, expect } from 'vitest';
import {
  DEVICE_STATE_TOPIC,
  DEVICE_ACK_TOPIC,
  HOMELINE_TOPIC,
  SCREEN_COMMAND_TOPIC,
  CLIENT_CONTROL_TOPIC,
  PLAYBACK_STATE_TOPIC,
  parseDeviceTopic,
} from './topics.mjs';

describe('topic builders', () => {
  it('builds per-device topics with the deviceId suffix', () => {
    expect(DEVICE_STATE_TOPIC('tv-living-room')).toBe('device-state:tv-living-room');
    expect(DEVICE_ACK_TOPIC('tv-living-room')).toBe('device-ack:tv-living-room');
    expect(HOMELINE_TOPIC('tv-living-room')).toBe('homeline:tv-living-room');
    expect(SCREEN_COMMAND_TOPIC('tv-living-room')).toBe('screen:tv-living-room');
  });
  it('builds per-client topics with the clientId suffix', () => {
    expect(CLIENT_CONTROL_TOPIC('c1')).toBe('client-control:c1');
  });
  it('exposes the broadcast topic as a constant', () => {
    expect(PLAYBACK_STATE_TOPIC).toBe('playback_state');
  });
  it('parses a per-device topic back into { kind, deviceId }', () => {
    expect(parseDeviceTopic('device-state:tv-1')).toEqual({ kind: 'device-state', deviceId: 'tv-1' });
    expect(parseDeviceTopic('homeline:tv-1')).toEqual({ kind: 'homeline', deviceId: 'tv-1' });
    expect(parseDeviceTopic('unrelated')).toBeNull();
  });
});
