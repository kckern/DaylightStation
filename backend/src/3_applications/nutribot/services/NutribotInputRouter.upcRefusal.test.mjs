/**
 * A malformed barcode reaches the router as a coded error from LogFoodFromUPC.
 * The router is the Telegram and web entry point: it answers with the one-line
 * sentence the error carries, and reports the refusal to its caller instead of
 * letting the error surface as a failed request.
 */
import { describe, it, expect, vi } from 'vitest';
import { NutribotInputRouter } from './NutribotInputRouter.mjs';
import { InvalidInputError } from '#apps/common/errors/SemanticErrors.mjs';

const silent = { debug() {}, info: vi.fn(), warn() {}, error() {} };

function harness(execute) {
  const useCase = { execute: vi.fn(execute) };
  const container = {
    getConversationStateStore: () => null,
    getFoodLogStore: () => null,
    getNutriListStore: () => ({ saveMany: vi.fn(async () => {}) }),
    getMessagingGateway: () => ({ sendMessage: vi.fn(async () => ({})) }),
    getLogFoodFromUPC: () => useCase,
  };
  const router = new NutribotInputRouter(container, { logger: silent });
  const rc = { sendMessage: vi.fn(async () => ({ messageId: 'm' })), updateMessage: vi.fn(async () => {}), deleteMessage: vi.fn(async () => {}) };
  return { router, rc, useCase };
}
const evt = (text) => ({ conversationId: 'telegram:b1_c2', userId: 'kc', messageId: '9', payload: { text } });

describe('NutribotInputRouter.handleUpc — refused barcodes', () => {
  it('replies with the refusal line and returns a refusal, not an error', async () => {
    const { router, rc } = harness(async () => {
      throw new InvalidInputError("That's a book (ISBN), not a food.", { code: 'NUTRIBOT_UPC_REJECTED', context: { reason: 'isbn', upc: '9780306406157' } });
    });
    const out = await router.handleUpc(evt('9780306406157'), rc);
    expect(rc.sendMessage).toHaveBeenCalledWith("That's a book (ISBN), not a food.", {});
    expect(out).toMatchObject({ ok: false, code: 'NUTRIBOT_UPC_REJECTED', rejected: 'isbn', message: "That's a book (ISBN), not a food." });
  });

  it('any other failure still throws', async () => {
    const { router, rc } = harness(async () => { throw new Error('OFF down'); });
    await expect(router.handleUpc(evt('037000338369'), rc)).rejects.toThrow('OFF down');
  });
});
