// tests/unit/suite/adapters/nutribot/NutribotInputRouterImageVoice.test.mjs
//
// B10: the web nutrition-input path threads an image data URL / a decoded
// voice buffer through NutribotInputRouter into LogFoodFromImage/LogFoodFromVoice
// unchanged. These assert the router's own wiring only — WebNutribotAdapter's
// encoding/decoding is covered separately.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NutribotInputRouter } from '#apps/nutribot/services/NutribotInputRouter.mjs';

function makeContainer(spies) {
  return {
    getConversationStateStore: () => null,
    getLogFoodFromText: () => ({ execute: spies.logText }),
    getLogFoodFromVoice: () => ({ execute: spies.logVoice }),
    getLogFoodFromImage: () => ({ execute: spies.logImage }),
    getLogFoodFromUPC: () => ({ execute: spies.logUpc }),
  };
}

describe('NutribotInputRouter image/voice wiring (web)', () => {
  let spies, router;

  beforeEach(() => {
    spies = {
      logText: jest.fn().mockResolvedValue({ success: true }),
      logVoice: jest.fn().mockResolvedValue({ success: true }),
      logImage: jest.fn().mockResolvedValue({ success: true }),
      logUpc: jest.fn().mockResolvedValue({ success: true }),
    };
    router = new NutribotInputRouter(makeContainer(spies), {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
  });

  const evt = (payload) => ({
    conversationId: 'web:kckern',
    userId: 'kckern',
    platform: 'web',
    platformUserId: 'kckern',
    messageId: null,
    payload,
  });

  it('passes payload.imageUrl through to imageData.url for LogFoodFromImage', async () => {
    await router.handleImage(evt({ fileId: null, imageUrl: 'data:image/jpeg;base64,AAAA', text: null }), {});

    expect(spies.logImage).toHaveBeenCalledTimes(1);
    const [input] = spies.logImage.mock.calls[0];
    expect(input.imageData).toMatchObject({ fileId: null, url: 'data:image/jpeg;base64,AAAA' });
  });

  it('still passes a Telegram fileId through imageData.fileId (regression, no url set)', async () => {
    await router.handleImage(evt({ fileId: 'tg-file-1', text: 'caption' }), {});

    expect(spies.logImage).toHaveBeenCalledTimes(1);
    const [input] = spies.logImage.mock.calls[0];
    expect(input.imageData).toMatchObject({ fileId: 'tg-file-1', url: undefined, caption: 'caption' });
  });

  it('passes payload.fileId through unchanged for LogFoodFromVoice, whatever shape it holds', async () => {
    const decoded = { buffer: Buffer.from('RIFF'), mimeType: 'audio/wav' };
    await router.handleVoice(evt({ fileId: decoded }), {});

    expect(spies.logVoice).toHaveBeenCalledTimes(1);
    const [input] = spies.logVoice.mock.calls[0];
    expect(input.voiceData).toEqual({ fileId: decoded });
  });

  it('still passes a plain Telegram fileId string through for voice (regression)', async () => {
    await router.handleVoice(evt({ fileId: 'tg-voice-1' }), {});

    expect(spies.logVoice).toHaveBeenCalledTimes(1);
    const [input] = spies.logVoice.mock.calls[0];
    expect(input.voiceData).toEqual({ fileId: 'tg-voice-1' });
  });

  it('text input is unaffected by the image/voice wiring (regression)', async () => {
    await router.handleText(evt({ text: 'two eggs' }), {});
    expect(spies.logText).toHaveBeenCalledTimes(1);
    const [input] = spies.logText.mock.calls[0];
    expect(input.text).toBe('two eggs');
  });
});
