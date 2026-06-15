import request from 'supertest';
import express from 'express';
import { createArtRouter } from '../../../../backend/src/4_api/v1/routers/art.mjs';

const noopLogger = { debug: () => {}, warn: () => {}, error: () => {}, info: () => {} };

const makeApp = (artAdapter) => {
  const app = express();
  app.use('/art', createArtRouter({ artAdapter, logger: noopLogger }));
  return app;
};

describe('Art Router', () => {
  it('GET /art/featured returns image + meta from the adapter', async () => {
    const artAdapter = {
      selectFeatured: async () => ({
        image: '/media/img/art/classic/Folder/Painting.jpg',
        meta: { title: 'Painting', artist: 'Someone', date: '1674', origin: 'Holland', medium: 'Oil' },
      }),
    };
    const res = await request(makeApp(artAdapter)).get('/art/featured');
    expect(res.status).toBe(200);
    expect(res.body.image).toBe('/media/img/art/classic/Folder/Painting.jpg');
    expect(res.body.meta.artist).toBe('Someone');
  });

  it('GET /art/featured returns 503 when no artwork is available', async () => {
    const artAdapter = {
      selectFeatured: async () => { throw new Error('No artwork available'); },
    };
    const res = await request(makeApp(artAdapter)).get('/art/featured');
    expect(res.status).toBe(503);
    expect(res.body.error).toBeTruthy();
  });
});
