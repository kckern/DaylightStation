// tests/unit/suite/adapters/nutribot/NutribotInputRouterScale.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NutribotInputRouter } from '#adapters/nutribot/NutribotInputRouter.mjs';

function makeContainer(spies) {
  return {
    getConversationStateStore: () => spies.stateStore,
    getSelectScaleContainer: () => ({ execute: spies.container }),
    getSelectScaleDensity: () => ({ execute: spies.density }),
    getLogScaleFoodFromText: () => ({ execute: spies.describe }),
    getLogFoodFromText: () => ({ execute: spies.logText }),
    getProcessRevisionInput: () => ({ execute: spies.revision }),
  };
}

describe('NutribotInputRouter scale routing', () => {
  let spies, router;
  beforeEach(() => {
    spies = {
      stateStore: { get: jest.fn().mockResolvedValue(null) },
      container: jest.fn().mockResolvedValue({ ok: true }),
      density: jest.fn().mockResolvedValue({ ok: true }),
      describe: jest.fn().mockResolvedValue({ ok: true }),
      logText: jest.fn().mockResolvedValue({ ok: true }),
      revision: jest.fn().mockResolvedValue({ ok: true }),
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

  it('routes scale_describe text to LogScaleFoodFromText', async () => {
    spies.stateStore.get = jest.fn().mockResolvedValue({ activeFlow: 'scale_describe', flowState: { pendingLogUuid: 'log1' } });
    await router.handleText(evt({ payload: { text: 'leftover lasagna' } }), {});
    expect(spies.describe).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'log1', text: 'leftover lasagna' }));
    expect(spies.logText).not.toHaveBeenCalled();
  });
});
