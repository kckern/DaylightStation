import { describe, expect, it } from 'vitest';
import { ScreenAddressResolver } from './ScreenAddressResolver.mjs';

describe('ScreenAddressResolver', () => {
  it('preserves configured paths and owns the living-room fallback', () => {
    const resolver = new ScreenAddressResolver();
    expect(resolver.resolve({ screenPath: '/screen/office' })).toEqual({ path: '/screen/office', name: 'office' });
    expect(resolver.resolve({})).toEqual({ path: '/screen/living-room', name: 'living-room' });
  });
});
