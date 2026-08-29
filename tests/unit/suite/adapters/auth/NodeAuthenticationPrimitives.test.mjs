import { describe, it, expect } from '@jest/globals';
import { NodeAuthenticationPrimitives } from '#adapters/auth/NodeAuthenticationPrimitives.mjs';

describe('NodeAuthenticationPrimitives', () => {
  it('generates a 64-byte hexadecimal JWT secret', () => {
    const authentication = new NodeAuthenticationPrimitives();
    const secret = authentication.createJwtSecret();

    expect(secret).toHaveLength(128);
    expect(secret).toMatch(/^[0-9a-f]+$/);
  });

  it('generates unique JWT secrets', () => {
    const authentication = new NodeAuthenticationPrimitives();
    expect(authentication.createJwtSecret()).not.toBe(authentication.createJwtSecret());
  });
});
