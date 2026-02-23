// tests/unit/suite/api/launch.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createLaunchRouter } from '#api/v1/routers/launch.mjs';

describe('POST /api/v1/launch', () => {
  let app;
  let mockLaunchService;

  beforeEach(() => {
    mockLaunchService = {
      launch: jest.fn().mockResolvedValue({
        success: true,
        contentId: 'retroarch:n64/mario-kart-64',
        targetDeviceId: 'shield-tv',
        title: 'Mario Kart 64'
      })
    };

    app = express();
    app.use(express.json());
    app.use('/api/v1/launch', createLaunchRouter({
      launchService: mockLaunchService,
      logger: { info: jest.fn(), error: jest.fn() }
    }));
  });

  it('returns 200 on successful launch', async () => {
    const res = await request(app)
      .post('/api/v1/launch')
      .send({ contentId: 'retroarch:n64/mario-kart-64', targetDeviceId: 'shield-tv' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.title).toBe('Mario Kart 64');
    expect(mockLaunchService.launch).toHaveBeenCalledWith({
      contentId: 'retroarch:n64/mario-kart-64',
      targetDeviceId: 'shield-tv'
    });
  });

  it('returns 400 when contentId missing', async () => {
    const res = await request(app)
      .post('/api/v1/launch')
      .send({ targetDeviceId: 'shield-tv' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when targetDeviceId missing', async () => {
    const res = await request(app)
      .post('/api/v1/launch')
      .send({ contentId: 'retroarch:n64/mario-kart-64' });

    expect(res.status).toBe(400);
  });
});
