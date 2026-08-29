import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AIConsoleService } from '#apps/ai/AIConsoleService.mjs';
import { createAIRouter } from './ai.mjs';
import { createEpaperApiRouter } from '#composition/modules/epaperApi.mjs';

function mounted(path, router) {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  return app;
}

const aiConsole = (openai = null, anthropic = null) => new AIConsoleService({
  providers: [{ id: 'openai', gateway: openai }, { id: 'anthropic', gateway: anthropic }],
  transcription: { id: 'openai', gateway: openai },
  embedding: { id: 'openai', gateway: openai },
});

describe('AI route characterization', () => {
  it('preserves arbitrary provider labels while falling back to OpenAI', async () => {
    const openai = {
      model: 'gpt-test',
      chat: vi.fn(async () => 'answer'),
      getMetrics: vi.fn(() => ({ requests: 1 })),
      resetMetrics: vi.fn(),
    };
    const app = mounted('/ai', createAIRouter({ aiService: aiConsole(openai) }));
    const response = await request(app).post('/ai/chat').send({
      messages: [{ role: 'user', content: 'hello' }],
      provider: 'future-provider',
      model: 'chosen-model',
      maxTokens: 17,
      temperature: 0.2,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ response: 'answer', provider: 'future-provider' });
    expect(openai.chat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'hello' }],
      { model: 'chosen-model', maxTokens: 17, temperature: 0.2 },
    );

    const status = await request(app).get('/ai');
    expect(status.body).toEqual({
      module: 'ai',
      providers: {
        openai: { configured: true, model: 'gpt-test' },
        anthropic: { configured: false, model: null },
      },
    });
  });

  it('keeps OpenAI availability checks ahead of request validation', async () => {
    const app = mounted('/ai', createAIRouter({ aiService: aiConsole() }));
    const response = await request(app).post('/ai/transcribe').send({});
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'OpenAI not configured (required for transcription)' });
  });

  it('preserves JSON, vision, transcription, embedding, and metrics contracts', async () => {
    const openai = {
      chatWithJson: vi.fn(async () => ({ value: 1 })),
      chatWithImage: vi.fn(async () => 'seen'),
      transcribe: vi.fn(async () => 'words'),
      embed: vi.fn(async () => [0.1, 0.2]),
      getMetrics: vi.fn(() => ({ requests: 4 })),
      resetMetrics: vi.fn(),
    };
    const app = mounted('/ai', createAIRouter({ aiService: aiConsole(openai) }));
    expect((await request(app).post('/ai/chat/json').send({ messages: [] })).body)
      .toEqual({ response: { value: 1 }, provider: 'openai' });
    expect((await request(app).post('/ai/chat/vision').send({ messages: [], imageUrl: 'image' })).body)
      .toEqual({ response: 'seen', provider: 'openai' });
    expect((await request(app).post('/ai/transcribe').send({ audioBase64: 'YQ==' })).body)
      .toEqual({ text: 'words', provider: 'openai' });
    expect((await request(app).post('/ai/embed').send({ text: 'hello' })).body)
      .toEqual({ embedding: [0.1, 0.2], dimensions: 2, provider: 'openai' });
    expect((await request(app).get('/ai/metrics')).body)
      .toEqual({ openai: { requests: 4 }, anthropic: null });
    expect((await request(app).post('/ai/metrics/reset')).body).toEqual({ success: true });
    expect(openai.resetMetrics).toHaveBeenCalledOnce();
  });
});

describe('ePaper route characterization', () => {
  it('serves cached PNG bytes with the established headers', async () => {
    const bytes = Buffer.from([137, 80, 78, 71]);
    const display = {
      getCached: vi.fn(() => bytes),
      render: vi.fn(),
      getStatus: vi.fn(() => ({ configured: true, hasCache: true })),
    };
    const app = mounted('/epaper', createEpaperApiRouter({ epaperAdapter: display }));
    const response = await request(app).get('/epaper/image.png');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['content-length']).toBe(String(bytes.length));
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(display.render).not.toHaveBeenCalled();
  });

  it('preserves render response fields and passes the body through', async () => {
    const display = {
      getCached: vi.fn(() => null),
      render: vi.fn(async () => Buffer.alloc(9)),
      getStatus: vi.fn(() => ({ configured: true })),
    };
    const app = mounted('/epaper', createEpaperApiRouter({
      epaperAdapter: display,
      clock: () => new Date('2026-08-28T12:34:56.000Z'),
    }));
    const response = await request(app).post('/epaper/render').send({ weather: 'sunny' });
    expect(response.body).toEqual({ ok: true, sizeBytes: 9, renderedAt: '2026-08-28T12:34:56.000Z' });
    expect(display.render).toHaveBeenCalledWith({ weather: 'sunny' });
  });

  it('preserves status and unconfigured responses through composition', async () => {
    const unavailable = mounted('/epaper', createEpaperApiRouter());
    expect((await request(unavailable).get('/epaper/status')).body)
      .toEqual({ error: 'ePaper adapter not configured' });
    expect((await request(unavailable).get('/epaper/status')).status).toBe(503);

    const display = {
      getCached: vi.fn(),
      render: vi.fn(),
      getStatus: vi.fn(() => ({ configured: true, displaySize: '1600x1200' })),
    };
    const available = mounted('/epaper', createEpaperApiRouter({ epaperAdapter: display }));
    expect((await request(available).get('/epaper/status')).body)
      .toEqual({ configured: true, displaySize: '1600x1200' });
  });
});
