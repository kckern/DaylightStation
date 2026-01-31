// tests/unit/domains/messaging/ports/IConversationStateDatastore.test.mjs
import { jest } from '@jest/globals';

describe('IConversationStateDatastore interface', () => {
  it('should define required methods', async () => {
    const { IConversationStateDatastore, isConversationStateDatastore } = await import('#backend/src/3_applications/shared/ports/index.mjs');

    const validStore = {
      get: async () => {},
      set: async () => {},
      delete: async () => {},
      clear: async () => {}
    };

    expect(isConversationStateDatastore(validStore)).toBe(true);
    expect(isConversationStateDatastore({})).toBe(false);
  });
});
