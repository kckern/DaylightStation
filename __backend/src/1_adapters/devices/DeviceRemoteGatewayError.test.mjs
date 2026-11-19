import { describe, expect, it } from 'vitest';
import { DeviceRemoteGatewayError } from './DeviceRemoteGatewayError.mjs';
import { DeviceRemoteGatewayError as FromFullyAdapter } from './FullyKioskRemoteAdministrationAdapter.mjs';

describe('DeviceRemoteGatewayError', () => {
  it('is one class, whichever module it is imported from', () => {
    expect(FromFullyAdapter).toBe(DeviceRemoteGatewayError);
  });

  it('carries a code and the name callers match on', () => {
    const error = new DeviceRemoteGatewayError('Device not found', 'DEVICE_NOT_FOUND');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DeviceRemoteGatewayError');
    expect(error.code).toBe('DEVICE_NOT_FOUND');
    expect(error.message).toBe('Device not found');
    expect(error).not.toHaveProperty('reason');
  });

  it('carries the device reason when one is given', () => {
    const error = new DeviceRemoteGatewayError('x', 'DAYLIGHT_ANDROID_UNSUPPORTED', { reason: 'device owner required' });
    expect(error.reason).toBe('device owner required');
  });
});
