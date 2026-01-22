// tests/unit/domains/messaging/ports/IConversationStateStore.test.mjs
import { jest } from '@jest/globals';

describe('IConversationStateStore interface', () => {
  it('should define required methods', async () => {
    const { IConversationStateStore, isConversationStateStore } = await import('@backend/src/1_domains/messaging/ports/IConversationStateStore.mjs');

    const validStore = {
      get: async () => {},
      set: async () => {},
      delete: async () => {},
      clear: async () => {}
    };

    expect(isConversationStateStore(validStore)).toBe(true);
    expect(isConversationStateStore({})).toBe(false);
  });
});
