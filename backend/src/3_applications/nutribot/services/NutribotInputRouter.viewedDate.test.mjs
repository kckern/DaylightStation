/**
 * The viewed day, through the nutribot pipeline.
 *
 * `NutribotInputRouter` is the only place that decides what each capture use
 * case is told, so it is the only place worth pinning: the day the client is
 * looking at must reach all four handlers, under the name each use case reads.
 *
 * The two names differ on purpose. Text and voice get `asOfDate`: their model
 * resolves relative phrases, so the viewed day is an ANCHOR the parse computes
 * from ("yesterday", spoken while viewing the 3rd, must mean the 2nd) — not a
 * value that overrides what was said. Image and barcode have no words to date
 * anything from, so they get a plain `date`.
 */
import { describe, it, expect, vi } from 'vitest';
import { NutribotInputRouter } from './NutribotInputRouter.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const VIEWED = '2026-09-03';

function makeHarness() {
  const useCase = { execute: vi.fn(async () => ({ success: true, nutrilogUuid: null })) };
  const container = {
    getConversationStateStore: () => null,
    getFoodLogStore: () => null,
    getNutriListStore: () => ({ saveMany: vi.fn(async () => {}) }),
    getMessagingGateway: () => ({ sendMessage: vi.fn(async () => ({})) }),
    getLogFoodFromText: () => useCase,
    getLogFoodFromImage: () => useCase,
    getLogFoodFromVoice: () => useCase,
    getLogFoodFromUPC: () => useCase,
  };
  const router = new NutribotInputRouter(container, { logger: silent });
  const rc = { sendMessage: vi.fn(async () => ({ messageId: 'm' })), updateMessage: vi.fn(async () => {}), deleteMessage: vi.fn(async () => {}) };
  return { router, useCase, rc };
}

const evt = (payload) => ({ conversationId: 'web:kc', userId: 'kc', messageId: null, payload });

describe('NutribotInputRouter — the viewed day reaches every handler', () => {
  it('handleText anchors the parse to the viewed day', async () => {
    const { router, useCase, rc } = makeHarness();
    await router.handleText(evt({ text: 'a burger', date: VIEWED }), rc);
    expect(useCase.execute.mock.calls[0][0].asOfDate).toBe(VIEWED);
  });

  it('handleVoice anchors the parse to the viewed day', async () => {
    const { router, useCase, rc } = makeHarness();
    await router.handleVoice(evt({ fileId: { buffer: Buffer.from('x') }, date: VIEWED }), rc);
    expect(useCase.execute.mock.calls[0][0].asOfDate).toBe(VIEWED);
  });

  it('handleImage dates the row by the viewed day', async () => {
    const { router, useCase, rc } = makeHarness();
    await router.handleImage(evt({ imageUrl: 'data:image/jpeg;base64,AA', date: VIEWED }), rc);
    expect(useCase.execute.mock.calls[0][0].date).toBe(VIEWED);
  });

  it('handleUpc dates the row by the viewed day', async () => {
    const { router, useCase, rc } = makeHarness();
    await router.handleUpc(evt({ text: '012345678905', date: VIEWED }), rc);
    expect(useCase.execute.mock.calls[0][0].date).toBe(VIEWED);
  });

  it('no viewed day: every handler passes null, so the wall clock still decides', async () => {
    const { router, useCase, rc } = makeHarness();
    await router.handleText(evt({ text: 'a burger' }), rc);
    await router.handleVoice(evt({ fileId: { buffer: Buffer.from('x') } }), rc);
    await router.handleImage(evt({ imageUrl: 'data:image/jpeg;base64,AA' }), rc);
    await router.handleUpc(evt({ text: '012345678905' }), rc);
    const [text, voice, image, upc] = useCase.execute.mock.calls.map((c) => c[0]);
    expect(text.asOfDate).toBeNull();
    expect(voice.asOfDate).toBeNull();
    expect(image.date).toBeNull();
    expect(upc.date).toBeNull();
  });
});
