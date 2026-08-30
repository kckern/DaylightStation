// tests/unit/suite/adapters/nutribot/NutribotInputRouterScale.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NutribotInputRouter } from '#apps/nutribot/services/NutribotInputRouter.mjs';

function makeContainer(spies) {
  return {
    getConversationStateStore: () => spies.stateStore,
    getSelectScaleContainer: () => ({ execute: spies.container }),
    getSelectScaleDensity: () => ({ execute: spies.density }),
    getShowScaleDensityHelp: () => ({ execute: spies.help }),
    getLogScaleFoodFromText: () => ({ execute: spies.describe }),
    getLogFoodFromText: () => ({ execute: spies.logText }),
    getLogFoodFromVoice: () => ({ execute: spies.logVoice }),
    getProcessRevisionInput: () => ({ execute: spies.revision }),
    getLogFoodFromImage: () => ({ execute: spies.logImage }),
    getRetryImageDetection: () => ({ execute: spies.retryImage }),
  };
}

describe('NutribotInputRouter scale routing', () => {
  let spies, router;
  beforeEach(() => {
    spies = {
      stateStore: { get: jest.fn().mockResolvedValue(null) },
      container: jest.fn().mockResolvedValue({ ok: true }),
      density: jest.fn().mockResolvedValue({ ok: true }),
      help: jest.fn().mockResolvedValue({ ok: true }),
      describe: jest.fn().mockResolvedValue({ ok: true }),
      logText: jest.fn().mockResolvedValue({ ok: true }),
      logVoice: jest.fn().mockResolvedValue({ ok: true }),
      revision: jest.fn().mockResolvedValue({ ok: true }),
      logImage: jest.fn().mockResolvedValue({ ok: true }),
      retryImage: jest.fn().mockResolvedValue({ ok: true }),
    };
    router = new NutribotInputRouter(makeContainer(spies), {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
  });

  const evt = (extra) => ({ conversationId: 'telegram:b1_c2', messageId: '900', userId: 'kckern', ...extra });

  it("routes 'st' callbacks to SelectScaleContainer", async () => {
    await router.handleCallback(evt({ payload: { callbackData: JSON.stringify({ cmd: 'st', id: 'log1', c: 'dinner-plate' }) } }), {});
    expect(spies.container).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'log1', containerId: 'dinner-plate' }));
  });

  it("routes 'sd' callbacks to SelectScaleDensity", async () => {
    await router.handleCallback(evt({ payload: { callbackData: JSON.stringify({ cmd: 'sd', id: 'log1', l: 4 }) } }), {});
    expect(spies.density).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'log1', level: 4 }));
  });

  it('returns a typed scale refusal without generic router error telemetry', async () => {
    const refusal = new Error('unknown level');
    refusal.code = 'NUTRIBOT_SCALE_UNKNOWN_LEVEL';
    spies.density.mockRejectedValue(refusal);

    await expect(router.route(evt({
      type: 'callback',
      payload: { callbackData: JSON.stringify({ cmd: 'sd', id: 'log1', l: 99 }) },
    }), {})).resolves.toMatchObject({ message: 'unknown level', code: 'NUTRIBOT_SCALE_UNKNOWN_LEVEL' });
  });

  it('does not swallow unexpected scale failures', async () => {
    spies.density.mockRejectedValue(new Error('datastore offline'));
    await expect(router.handleCallback(evt({
      payload: { callbackData: JSON.stringify({ cmd: 'sd', id: 'log1', l: 4 }) },
    }), {})).rejects.toThrow('datastore offline');
  });

  it('routes scale_describe text to LogScaleFoodFromText', async () => {
    spies.stateStore.get = jest.fn().mockResolvedValue({ activeFlow: 'scale_describe', flowState: { pendingLogUuid: 'log1' } });
    await router.handleText(evt({ payload: { text: 'leftover lasagna' } }), {});
    expect(spies.describe).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'log1', text: 'leftover lasagna' }));
    expect(spies.logText).not.toHaveBeenCalled();
  });

  it("routes 'sh' (h:1) to ShowScaleDensityHelp with showHelp true", async () => {
    await router.handleCallback(evt({ payload: { callbackData: JSON.stringify({ cmd: 'sh', id: 'log1', h: 1 }) } }), {});
    expect(spies.help).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'log1', showHelp: true }));
  });

  it("routes 'sh' (h:0) to ShowScaleDensityHelp with showHelp false", async () => {
    await router.handleCallback(evt({ payload: { callbackData: JSON.stringify({ cmd: 'sh', id: 'log1', h: 0 }) } }), {});
    expect(spies.help).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'log1', showHelp: false }));
  });

  it('returns a visible refusal instead of throwing when image AI is unavailable', async () => {
    router = new NutribotInputRouter(makeContainer(spies), {
      aiGatewayAvailable: false,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    const responseContext = { sendMessage: jest.fn().mockResolvedValue() };

    await expect(router.handleImage(evt({ payload: { fileId: 'photo-1' } }), responseContext))
      .resolves.toMatchObject({ ok: false, code: 'AI_UNAVAILABLE' });

    expect(spies.logImage).not.toHaveBeenCalled();
    expect(responseContext.sendMessage).toHaveBeenCalledWith(expect.stringContaining('temporarily unavailable'));
  });

  it.each([
    ['text', (router, event, context) => router.handleText(event, context), 'logText'],
    ['voice', (router, event, context) => router.handleVoice(event, context), 'logVoice'],
  ])('does not invoke AI-backed %s intake when AI is unavailable', async (_type, invoke, spyName) => {
    router = new NutribotInputRouter(makeContainer(spies), {
      aiGatewayAvailable: false,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    const responseContext = { sendMessage: jest.fn().mockResolvedValue() };

    await expect(invoke(router, evt({ payload: { text: 'apple', fileId: 'voice-1' } }), responseContext))
      .resolves.toMatchObject({ ok: false, code: 'AI_UNAVAILABLE' });

    expect(spies[spyName]).not.toHaveBeenCalled();
    expect(responseContext.sendMessage).toHaveBeenCalledWith(expect.stringContaining('temporarily unavailable'));
  });

  it('does not retry image detection through AI when unavailable', async () => {
    router = new NutribotInputRouter(makeContainer(spies), { aiGatewayAvailable: false, logger: { warn() {} } });
    const responseContext = { sendMessage: jest.fn().mockResolvedValue() };
    await expect(router.handleCallback(evt({ payload: { callbackData: JSON.stringify({ cmd: 'ir' }) } }), responseContext))
      .resolves.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(spies.retryImage).not.toHaveBeenCalled();
  });

  it('does not send scale descriptions to AI when unavailable', async () => {
    spies.stateStore.get = jest.fn().mockResolvedValue({ activeFlow: 'scale_describe', flowState: { pendingLogUuid: 'log1' } });
    router = new NutribotInputRouter(makeContainer(spies), { aiGatewayAvailable: false, logger: { debug() {}, warn() {} } });
    await expect(router.handleText(evt({ payload: { text: 'oatmeal' } }), { sendMessage: jest.fn().mockResolvedValue() }))
      .resolves.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(spies.describe).not.toHaveBeenCalled();
  });
});
