/**
 * Tests for Port Interfaces
 * @group Phase2
 */

import {
  isMessagingGateway,
  assertMessagingGateway,
} from '../../application/ports/IMessagingGateway.mjs';

import {
  isAIGateway,
  assertAIGateway,
  systemMessage,
  userMessage,
  assistantMessage,
} from '../../application/ports/IAIGateway.mjs';

import {
  isRepository,
  assertRepository,
} from '../../application/ports/IRepository.mjs';

import {
  isConversationStateStore,
  assertConversationStateStore,
} from '../../application/ports/IConversationStateStore.mjs';

describe('Phase2: IMessagingGateway', () => {
  const validGateway = {
    sendMessage: () => {},
    sendImage: () => {},
    updateMessage: () => {},
    updateKeyboard: () => {},
    deleteMessage: () => {},
    transcribeVoice: () => {},
    getFileUrl: () => {},
  };

  describe('isMessagingGateway', () => {
    it('should return true for valid gateway', () => {
      expect(isMessagingGateway(validGateway)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isMessagingGateway(null)).toBe(false);
    });

    it('should return false for missing methods', () => {
      const incomplete = { sendMessage: () => {} };
      expect(isMessagingGateway(incomplete)).toBe(false);
    });

    it('should return false for non-function properties', () => {
      const invalid = { ...validGateway, sendMessage: 'not a function' };
      expect(isMessagingGateway(invalid)).toBe(false);
    });
  });

  describe('assertMessagingGateway', () => {
    it('should return gateway if valid', () => {
      expect(assertMessagingGateway(validGateway)).toBe(validGateway);
    });

    it('should throw for invalid gateway', () => {
      expect(() => assertMessagingGateway({})).toThrow(/IMessagingGateway/);
    });
  });
});

describe('Phase2: IAIGateway', () => {
  const validGateway = {
    chat: () => {},
    chatWithImage: () => {},
    chatWithJson: () => {},
    transcribe: () => {},
    embed: () => {},
  };

  describe('isAIGateway', () => {
    it('should return true for valid gateway', () => {
      expect(isAIGateway(validGateway)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isAIGateway(null)).toBe(false);
    });

    it('should return false for missing methods', () => {
      const incomplete = { chat: () => {} };
      expect(isAIGateway(incomplete)).toBe(false);
    });
  });

  describe('assertAIGateway', () => {
    it('should return gateway if valid', () => {
      expect(assertAIGateway(validGateway)).toBe(validGateway);
    });

    it('should throw for invalid gateway', () => {
      expect(() => assertAIGateway({})).toThrow(/IAIGateway/);
    });
  });

  describe('message helpers', () => {
    it('systemMessage should create system message', () => {
      const msg = systemMessage('You are helpful');
      expect(msg).toEqual({ role: 'system', content: 'You are helpful' });
    });

    it('userMessage should create user message', () => {
      const msg = userMessage('Hello');
      expect(msg).toEqual({ role: 'user', content: 'Hello' });
    });

    it('assistantMessage should create assistant message', () => {
      const msg = assistantMessage('Hi there');
      expect(msg).toEqual({ role: 'assistant', content: 'Hi there' });
    });
  });
});

describe('Phase2: IRepository', () => {
  const validRepo = {
    save: () => {},
    findById: () => {},
    findAll: () => {},
    update: () => {},
    delete: () => {},
    exists: () => {},
  };

  describe('isRepository', () => {
    it('should return true for valid repository', () => {
      expect(isRepository(validRepo)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isRepository(null)).toBe(false);
    });

    it('should return false for missing methods', () => {
      const incomplete = { save: () => {}, findById: () => {} };
      expect(isRepository(incomplete)).toBe(false);
    });
  });

  describe('assertRepository', () => {
    it('should return repository if valid', () => {
      expect(assertRepository(validRepo)).toBe(validRepo);
    });

    it('should throw for invalid repository', () => {
      expect(() => assertRepository({})).toThrow(/IRepository/);
    });
  });
});

describe('Phase2: IConversationStateStore', () => {
  const validStore = {
    get: () => {},
    set: () => {},
    update: () => {},
    clear: () => {},
    clearFlow: () => {},
  };

  describe('isConversationStateStore', () => {
    it('should return true for valid store', () => {
      expect(isConversationStateStore(validStore)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isConversationStateStore(null)).toBe(false);
    });

    it('should return false for missing methods', () => {
      const incomplete = { get: () => {}, set: () => {} };
      expect(isConversationStateStore(incomplete)).toBe(false);
    });
  });

  describe('assertConversationStateStore', () => {
    it('should return store if valid', () => {
      expect(assertConversationStateStore(validStore)).toBe(validStore);
    });

    it('should throw for invalid store', () => {
      expect(() => assertConversationStateStore({})).toThrow(/IConversationStateStore/);
    });
  });
});
