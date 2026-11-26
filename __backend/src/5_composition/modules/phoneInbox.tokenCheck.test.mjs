import { describe, it, expect, vi } from 'vitest';
import { createDeviceTokenCheck } from './phoneInbox.mjs';

describe('createDeviceTokenCheck', () => {
  it('accepts only the device\'s own token', () => {
    const check = createDeviceTokenCheck({ tokenFor: (id) => (id === 'phone' ? 'secret-token' : '') });
    expect(check('phone', 'secret-token')).toBe(true);
    expect(check('phone', 'secret-tokem')).toBe('wrong_token');
    expect(check('phone', '')).toBe('no_token');
  });

  it('refuses a device the household holds no token for', () => {
    const check = createDeviceTokenCheck({ tokenFor: () => '' });
    expect(check('garage-tv', 'secret-token')).toBe('no_token_configured');
  });

  it('a rotated token works without a restart: a miss re-reads the file, at most once a minute', () => {
    let now = 0;
    let onDisk = 'new-token';
    const tokenFor = vi.fn((id, { fresh = false } = {}) => (fresh ? onDisk : 'old-token'));
    const check = createDeviceTokenCheck({ tokenFor, now: () => now });
    expect(check('phone', 'new-token')).toBe(true);
    expect(tokenFor).toHaveBeenCalledWith('phone', { fresh: true });
    onDisk = 'newer-token';
    now += 10_000;
    expect(check('phone', 'newer-token')).toBe('wrong_token');
    now += 60_000;
    expect(check('phone', 'newer-token')).toBe(true);
  });
});
