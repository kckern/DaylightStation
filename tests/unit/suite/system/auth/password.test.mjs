import { describe, it, expect } from '@jest/globals';
import { hashPassword, verifyPassword } from '#system/auth/password.mjs';

describe('password utilities', () => {
  it('hashes a password and returns a bcrypt string', async () => {
    const hash = await hashPassword('test-password');
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it('verifies correct password returns true', async () => {
    const hash = await hashPassword('test-password');
    const result = await verifyPassword('test-password', hash);
    expect(result).toBe(true);
  });

  it('verifies wrong password returns false', async () => {
    const hash = await hashPassword('test-password');
    const result = await verifyPassword('wrong-password', hash);
    expect(result).toBe(false);
  });

  it('produces different hashes for same password (salted)', async () => {
    const hash1 = await hashPassword('test-password');
    const hash2 = await hashPassword('test-password');
    expect(hash1).not.toBe(hash2);
  });
});
