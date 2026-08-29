// tests/unit/suite/api/admin/images.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
import { createAdminImagesRouter } from '#api/v1/routers/admin/images.mjs';
import express from 'express';
import request from 'supertest';

describe('Admin Images Router', () => {
  it('should create a router with required dependencies', () => {
    const mockConfig = {
      imageService: {
        maxFileSize: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg'],
        isAllowedMimeType: () => true,
      },
      logger: { info: jest.fn(), error: jest.fn() }
    };

    const router = createAdminImagesRouter(mockConfig);
    expect(router).toBeDefined();
    expect(typeof router.post).toBe('function');
  });

  it('should create a router with default logger if not provided', () => {
    const mockConfig = {
      imageService: {
        maxFileSize: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg'],
        isAllowedMimeType: () => true,
      }
    };

    const router = createAdminImagesRouter(mockConfig);
    expect(router).toBeDefined();
  });

  it('preserves list and URL-upload response envelopes through the injected service', async () => {
    const imageService = {
      maxFileSize: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg'],
      isAllowedMimeType: () => true,
      list: jest.fn(() => [{ filename: 'a.jpg', path: '/media/img/lists/a.jpg', size: 1, modified: '2026-01-01T00:00:00.000Z' }]),
      uploadFromUrl: jest.fn(async () => ({ path: '/media/img/lists/id.jpg', size: 3, type: 'image/jpeg' })),
    };
    const app = express().use('/images', createAdminImagesRouter({ imageService, logger: { info() {}, error() {} } }));

    const listed = await request(app).get('/images/list');
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ images: [{ filename: 'a.jpg', path: '/media/img/lists/a.jpg', size: 1, modified: '2026-01-01T00:00:00.000Z' }] });

    const uploaded = await request(app).post('/images/upload-url').send({ url: 'https://example.test/a.jpg' });
    expect(uploaded.status).toBe(200);
    expect(uploaded.body).toEqual({ ok: true, path: '/media/img/lists/id.jpg', size: 3, type: 'image/jpeg' });
    expect(imageService.uploadFromUrl).toHaveBeenCalledWith('https://example.test/a.jpg');
  });
});
