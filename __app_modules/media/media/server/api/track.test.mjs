import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTrackRouter, clampSamples } from './track.mjs';

function app(trackExtras) {
  const a = express();
  a.use('/track', createTrackRouter({ trackExtras, logger: { debug() {} } }));
  return a;
}

describe('GET /track/levels/:source/*', () => {
  it('answers samples and quality, clamping the sample count', async () => {
    const trackExtras = { levels: vi.fn(async () => ({ kind: 'ok', samples: [0.5], quality: { codec: 'mp3' } })) };
    const res = await request(app(trackExtras)).get('/track/levels/plex/352346?samples=9999').expect(200);
    expect(res.body).toEqual({ samples: [0.5], quality: { codec: 'mp3' }, source: 'plex' });
    expect(trackExtras.levels).toHaveBeenCalledWith('plex', '352346', 400);
  });

  it('omits quality when unknown, 204 for nothing, 404 for unknown', async () => {
    let res = await request(app({ levels: async () => ({ kind: 'ok', samples: [1], quality: null }) })).get('/track/levels/plex/1').expect(200);
    expect(res.body).toEqual({ samples: [1], source: 'plex' });
    await request(app({ levels: async () => ({ kind: 'none' }) })).get('/track/levels/files/a/b.mp3').expect(204);
    await request(app({ levels: async () => ({ kind: 'not_found' }) })).get('/track/levels/plex/9').expect(404);
  });
});

describe('GET /track/lyrics/:source/*', () => {
  it('answers lines, 204 for none, 404 for unknown', async () => {
    const lines = [{ ms: 1000, text: 'hi' }];
    const res = await request(app({ lyrics: async () => ({ kind: 'ok', synced: true, lines, provider: 'plex' }) })).get('/track/lyrics/plex/1').expect(200);
    expect(res.body).toEqual({ synced: true, lines, provider: 'plex' });
    await request(app({ lyrics: async () => ({ kind: 'none' }) })).get('/track/lyrics/plex/1').expect(204);
    await request(app({ lyrics: async () => ({ kind: 'not_found' }) })).get('/track/lyrics/plex/1').expect(404);
  });

  it('passes a nested local id through', async () => {
    const trackExtras = { lyrics: vi.fn(async () => ({ kind: 'none' })) };
    await request(app(trackExtras)).get('/track/lyrics/files/music/a%20b.mp3').expect(204);
    expect(trackExtras.lyrics).toHaveBeenCalledWith('files', 'music/a b.mp3');
  });
});

describe('clampSamples', () => {
  it('defaults, clamps and parses', () => {
    expect(clampSamples(undefined)).toBe(120);
    expect(clampSamples('5')).toBe(16);
    expect(clampSamples('9999')).toBe(400);
    expect(clampSamples('64')).toBe(64);
  });
});
