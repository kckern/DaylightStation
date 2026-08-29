import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from '#api/v1/routers/fitness.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function mount(config) {
  const app = express();
  app.use('/', createFitnessRouter({ logger: silent, ...config }));
  return app;
}

describe('GET /menu-music', () => {
  it('translates the semantic menu projection without operating the catalog', async () => {
    const execute = vi.fn(() => ({ tracks: ['media/fitness/ux/menus/a.mp3'], volume: 0.2 }));
    const response = await request(mount({ getFitnessMenuMusic: { execute } }))
      .get('/menu-music?household=home');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ tracks: ['media/fitness/ux/menus/a.mp3'], volume: 0.2 });
    expect(execute).toHaveBeenCalledWith('home');
  });

  it('preserves the historical empty-list response when the optional catalog is absent', async () => {
    const fitnessConfigService = { getMenuMusicVolume: () => 0.3 };
    const response = await request(mount({ fitnessConfigService })).get('/menu-music');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ tracks: [], volume: 0.3 });
  });
});
