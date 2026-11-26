import { describe, it, expect } from 'vitest';
import { createDeviceTokenCheck } from './phoneInbox.mjs';

describe('createDeviceTokenCheck', () => {
  const check = createDeviceTokenCheck({ tokenFor: (id) => (id === 'phone' ? 'secret-token' : '') });
  it('accepts only the device\'s own token', () => {
    expect(check('phone', 'secret-token')).toBe(true);
    expect(check('phone', 'secret-tokem')).toBe('wrong_token');
    expect(check('phone', 'secret-token-longer')).toBe('wrong_token');
    expect(check('phone', '')).toBe('no_token');
  });
  it('refuses a device the household holds no token for', () => {
    expect(check('garage-tv', 'secret-token')).toBe('no_token_configured');
  });
});
