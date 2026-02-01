// tests/unit/suite/api/admin/images.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
import { createAdminImagesRouter } from '#api/v1/routers/admin/images.mjs';

describe('Admin Images Router', () => {
  it('should create a router with required dependencies', () => {
    const mockConfig = {
      mediaPath: '/media',
      logger: { info: jest.fn(), error: jest.fn() }
    };

    const router = createAdminImagesRouter(mockConfig);
    expect(router).toBeDefined();
    expect(typeof router.post).toBe('function');
  });

  it('should create a router with default logger if not provided', () => {
    const mockConfig = {
      mediaPath: '/media'
    };

    const router = createAdminImagesRouter(mockConfig);
    expect(router).toBeDefined();
  });
});
