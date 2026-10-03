import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { withRequestContext } from './requestContext.mjs';
import { currentRequestContext } from '../../runtime/requestContext.mjs';

describe('withRequestContext', () => {
  it('exposes the caller\'s User-Agent and X-Daylight-Device to code down the async chain', async () => {
    const inner = express.Router();
    inner.get('/x', async (req, res) => {
      await new Promise((r) => setTimeout(r, 5));
      res.json(currentRequestContext());
    });
    const app = express();
    app.use('/api', withRequestContext(inner));
    app.get('/plain', (req, res) => res.json({ ctx: currentRequestContext() }));
    const wrapped = await request(app).get('/api/x').set('User-Agent', 'HomeAssistant/2026.9 aiohttp/3.9').set('X-Daylight-Device', 'browser:abc');
    expect(wrapped.body).toEqual({ userAgent: 'HomeAssistant/2026.9 aiohttp/3.9', device: 'browser:abc' });
    expect((await request(app).get('/plain')).body).toEqual({ ctx: null });
  });
});
