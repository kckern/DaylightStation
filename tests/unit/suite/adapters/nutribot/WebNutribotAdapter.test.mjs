// tests/unit/suite/adapters/nutribot/WebNutribotAdapter.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { WebNutribotAdapter } from '#adapters/nutribot/WebNutribotAdapter.mjs';

describe('WebNutribotAdapter', () => {
  let inputRouter;
  let adapter;

  beforeEach(() => {
    inputRouter = {
      handleText: jest.fn().mockResolvedValue({ ok: true }),
      handleVoice: jest.fn().mockResolvedValue({ ok: true }),
      handleImage: jest.fn().mockResolvedValue({ ok: true }),
      handleUpc: jest.fn().mockResolvedValue({ ok: true, result: {} }),
    };
    adapter = new WebNutribotAdapter({ inputRouter });
  });

  it('routes text content through unchanged (regression)', async () => {
    await adapter.process({ type: 'text', content: 'two eggs and toast', userId: 'kckern' });

    expect(inputRouter.handleText).toHaveBeenCalledTimes(1);
    const [event] = inputRouter.handleText.mock.calls[0];
    expect(event.payload.text).toBe('two eggs and toast');
    expect(event.payload.imageUrl).toBeUndefined();
    expect(event.payload.fileId).toBeUndefined();
  });

  it('routes barcode content to handleUpc via payload.text (regression)', async () => {
    await adapter.process({ type: 'barcode', content: '012345678905', userId: 'kckern' });

    expect(inputRouter.handleUpc).toHaveBeenCalledTimes(1);
    expect(inputRouter.handleImage).not.toHaveBeenCalled();
    expect(inputRouter.handleVoice).not.toHaveBeenCalled();
    const [event] = inputRouter.handleUpc.mock.calls[0];
    expect(event.payload.text).toBe('012345678905');
  });

  it('threads an image data URL through to payload.imageUrl, leaving fileId null', async () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD';
    await adapter.process({ type: 'image', content: dataUrl, userId: 'kckern' });

    expect(inputRouter.handleImage).toHaveBeenCalledTimes(1);
    const [event] = inputRouter.handleImage.mock.calls[0];
    expect(event.payload.imageUrl).toBe(dataUrl);
    expect(event.payload.fileId).toBeNull();
  });

  it('decodes a voice data URL into a { buffer, mimeType } pair on payload.fileId', async () => {
    const base64 = Buffer.from('RIFF1234WAVEfmt ').toString('base64');
    const dataUrl = `data:audio/wav;base64,${base64}`;
    await adapter.process({ type: 'voice', content: dataUrl, userId: 'kckern' });

    expect(inputRouter.handleVoice).toHaveBeenCalledTimes(1);
    const [event] = inputRouter.handleVoice.mock.calls[0];
    expect(event.payload.fileId.mimeType).toBe('audio/wav');
    expect(Buffer.isBuffer(event.payload.fileId.buffer)).toBe(true);
    expect(event.payload.fileId.buffer.slice(0, 4).toString('utf8')).toBe('RIFF');
  });

  it('decodes a MediaRecorder-style data URL carrying a codec param (data:audio/webm;codecs=opus;base64,...)', async () => {
    const base64 = Buffer.from('webm-bytes').toString('base64');
    const dataUrl = `data:audio/webm;codecs=opus;base64,${base64}`;
    await adapter.process({ type: 'voice', content: dataUrl, userId: 'kckern' });

    expect(inputRouter.handleVoice).toHaveBeenCalledTimes(1);
    const [event] = inputRouter.handleVoice.mock.calls[0];
    // mimeType is the bare type; the codec param is not part of it, matching
    // what TelegramAdapter's #extensionForMimeType expects.
    expect(event.payload.fileId.mimeType).toBe('audio/webm');
    expect(event.payload.fileId.buffer.toString('utf8')).toBe('webm-bytes');
  });

  it('rejects malformed voice content instead of silently succeeding', async () => {
    await expect(
      adapter.process({ type: 'voice', content: 'not-a-data-url', userId: 'kckern' })
    ).rejects.toThrow(/data URL/);
    expect(inputRouter.handleVoice).not.toHaveBeenCalled();
  });

  it('rejects malformed image content instead of silently succeeding', async () => {
    await expect(
      adapter.process({ type: 'image', content: 'plain-base64-no-prefix', userId: 'kckern' })
    ).rejects.toThrow(/data URL/);
    expect(inputRouter.handleImage).not.toHaveBeenCalled();
  });

  it('rejects an empty voice payload rather than forwarding a zero-byte buffer', async () => {
    await expect(
      adapter.process({ type: 'voice', content: 'data:audio/wav;base64,', userId: 'kckern' })
    ).rejects.toThrow();
    expect(inputRouter.handleVoice).not.toHaveBeenCalled();
  });
});
