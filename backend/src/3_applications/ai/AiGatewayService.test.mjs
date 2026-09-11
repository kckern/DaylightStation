// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { AiGatewayService } from './AiGatewayService.mjs';

const fake = (name) => ({
  chat: vi.fn(async () => `${name} said hi`),
  chatWithJson: vi.fn(async () => ({ from: name })),
  chatWithImage: vi.fn(async () => `${name} saw it`),
  transcribe: vi.fn(async () => 'words'),
  embed: vi.fn(async () => [0.1]),
  getMetrics: vi.fn(() => ({ totals: { requests: 1 } })),
  resetMetrics: vi.fn(),
});

describe('AiGatewayService', () => {
  it('answers status without any provider, and null for every call', async () => {
    const svc = new AiGatewayService({ openai: null, anthropic: null });
    expect(svc.status()).toEqual({ providers: [], default: null, transcription: false, embedding: false });
    expect(await svc.chat([{ role: 'user', content: 'x' }])).toBeNull();
    expect(await svc.transcribe(Buffer.alloc(1))).toBeNull();
    expect(await svc.embed('x')).toBeNull();
  });

  it('routes to the named provider and falls back to the default', async () => {
    const openai = fake('openai'); const anthropic = fake('anthropic');
    const svc = new AiGatewayService({ openai, anthropic });
    expect(await svc.chat([{ role: 'user', content: 'x' }], { provider: 'anthropic', maxTokens: 5 }))
      .toEqual({ provider: 'anthropic', content: 'anthropic said hi' });
    expect(anthropic.chat).toHaveBeenCalledWith([{ role: 'user', content: 'x' }], { maxTokens: 5 });
    expect(await svc.chatJson([{ role: 'user', content: 'x' }])).toEqual({ provider: 'openai', json: { from: 'openai' } });
    expect(await svc.chat([], { provider: 'nope' })).toBeNull();
  });

  it('transcription and embedding are openai-only', async () => {
    const svc = new AiGatewayService({ anthropic: fake('anthropic') });
    expect(svc.status().default).toBe('anthropic');
    expect(svc.supportsTranscription()).toBe(false);
    expect(await svc.embed('x')).toBeNull();
  });

  it('reports and resets metrics per provider', () => {
    const openai = fake('openai');
    const svc = new AiGatewayService({ openai }, { logger: { info: vi.fn() } });
    expect(svc.metrics()).toEqual({ openai: { totals: { requests: 1 } } });
    svc.resetMetrics();
    expect(openai.resetMetrics).toHaveBeenCalled();
  });
});
