// tests/isolated/hooks/useMediaQueue.test.mjs
import { describe, test, expect } from '@jest/globals';

describe('useMediaQueue module', () => {
  test('exports useMediaQueue function', async () => {
    // Dynamic import to test module structure
    const mod = await import('#frontend/hooks/media/useMediaQueue.js');
    expect(typeof mod.useMediaQueue).toBe('function');
  });
});
