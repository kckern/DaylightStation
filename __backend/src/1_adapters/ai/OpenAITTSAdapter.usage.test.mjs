import { describe, expect, it, vi } from 'vitest';
import { OpenAITTSAdapter } from './OpenAITTSAdapter.mjs';
import { runWithOrigin } from '#system/runtime/aiContext.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function tts({ fail = false } = {}) {
  const ledger = { record: vi.fn() };
  const downloadBuffer = vi.fn(async () => {
    if (fail) throw Object.assign(new Error('upstream 500'), { status: 500 });
    return Buffer.from('mp3');
  });
  const adapter = new OpenAITTSAdapter({ apiKey: 'k' }, { httpClient: { downloadBuffer }, logger: silent, aiUsageLedger: ledger });
  return { adapter, ledger, downloadBuffer };
}

describe('OpenAITTSAdapter usage ledger', () => {
  it('writes one row per synthesis priced by characters', async () => {
    const { adapter, ledger } = tts();
    await adapter.generateSpeechBuffer('Hello there', { model: 'tts-1' });
    expect(ledger.record).toHaveBeenCalledTimes(1);
    expect(ledger.record.mock.calls[0][0]).toMatchObject({
      provider: 'openai', endpoint: '/audio/speech', model: 'tts-1', characters: 11,
      costUsd: 11 * 15 / 1e6, status: 'ok', app: null, feature: null, origin: null,
    });
  });

  it('prices tts-1-hd at its own rate', async () => {
    const { adapter, ledger } = tts();
    await adapter.generateSpeech('abcd', { model: 'tts-1-hd' });
    expect(ledger.record.mock.calls[0][0].costUsd).toBe(4 * 30 / 1e6);
  });

  it('attributes through a scoped view, with the origin, and keeps tags out of the request', async () => {
    const { adapter, ledger, downloadBuffer } = tts();
    const view = adapter.scoped({ app: 'livestream' }).scoped({ feature: 'announcer' });
    await runWithOrigin('job:morning-show', () => view.generateSpeechBuffer('Good morning'));
    expect(ledger.record.mock.calls[0][0]).toMatchObject({ app: 'livestream', feature: 'announcer', origin: 'job:morning-show' });
    expect(downloadBuffer.mock.calls[0][1].body).not.toContain('usageTags');
    expect(view.isConfigured()).toBe(true);
    expect(() => { view.x = 1; }).toThrow(/read-only/);
  });

  it('records a failed synthesis at zero cost and still throws', async () => {
    const { adapter, ledger } = tts({ fail: true });
    await expect(adapter.scoped({ app: 'livestream' }).generateSpeech('hi')).rejects.toThrow('TTS generation failed');
    expect(ledger.record.mock.calls[0][0]).toMatchObject({ status: 'error', costUsd: 0, httpStatus: 500, error: 'upstream 500', app: 'livestream' });
  });

  it('works without a ledger', async () => {
    const adapter = new OpenAITTSAdapter({ apiKey: 'k' }, { httpClient: { downloadBuffer: async () => Buffer.from('x') }, logger: silent });
    await expect(adapter.generateSpeechBuffer('hi')).resolves.toEqual(Buffer.from('x'));
  });
});
