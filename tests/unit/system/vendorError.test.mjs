import { describe, it, expect } from 'vitest';
import { translateVendorError, isTransientStatus } from '#system/utils/errors/vendorError.mjs';

describe('translateVendorError', () => {
  it('maps status to generic code and sets isTransient', () => {
    const e = translateVendorError({ status: 429, message: 'Telegram: too many requests' }, { op: 'sendMessage' });
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.isTransient).toBe(true);
    expect(e.message).not.toMatch(/Telegram/); // vendor name must not leak
  });
  it('flags network errors transient', () => {
    expect(isTransientStatus({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientStatus({ status: 404 })).toBe(false);
  });
});
