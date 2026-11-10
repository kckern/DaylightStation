import { describe, expect, it } from 'vitest';
import { canRotateOAuthTokens } from '#system/runtime/runtimeEnvironment.mjs';

describe('canRotateOAuthTokens', () => {
  it('allows the container', () => expect(canRotateOAuthTokens({ env: {}, isContainer: true })).toBe(true));
  it('refuses a bare dev process', () => expect(canRotateOAuthTokens({ env: {}, isContainer: false })).toBe(false));
  it('allows an explicit token writer', () =>
    expect(canRotateOAuthTokens({ env: { DAYLIGHT_TOKEN_WRITER: 'true' }, isContainer: false })).toBe(true));
  it('ignores values other than "true"', () =>
    expect(canRotateOAuthTokens({ env: { DAYLIGHT_TOKEN_WRITER: '1' }, isContainer: false })).toBe(false));
});
