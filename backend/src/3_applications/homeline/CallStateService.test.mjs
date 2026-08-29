import { afterEach, describe, expect, it, vi } from 'vitest';
import { forceEndCall, hasActiveCall, setCallLeaseAuthority } from './CallStateService.mjs';

describe('CallStateService lease authority', () => {
  afterEach(() => setCallLeaseAuthority(null));

  it('blocks legacy force teardown while a server lease is active', () => {
    const authority = { hasActive: vi.fn(deviceId => deviceId === 'tv') };
    setCallLeaseAuthority(authority);
    expect(hasActiveCall('tv')).toBe(true);
    expect(forceEndCall('tv')).toBe(false);
  });
});
