// tests/unit/applications/journalist/usecases/ProcessTextEntry.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('ProcessTextEntry', () => {
  let ProcessTextEntry;
  let useCase;
  let mockMessagingGateway;
  let mockAiGateway;
  let mockJournalEntryRepository;
  let mockMessageQueueRepository;
  let mockConversationStateStore;
  let mockLogger;

  beforeEach(async () => {
    // Reset mocks
    mockMessagingGateway = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: 'sent-msg-123' }),
    };

    mockAiGateway = {
      chat: jest.fn(),
    };

    mockJournalEntryRepository = {
      saveMessage: jest.fn().mockResolvedValue(undefined),
      getMessageHistory: jest.fn().mockResolvedValue([]),
    };

    mockMessageQueueRepository = {
      add: jest.fn().mockResolvedValue(undefined),
      peek: jest.fn().mockResolvedValue(null),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    mockConversationStateStore = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Dynamic import after mocks are set up
    const module = await import('#backend/src/3_applications/journalist/usecases/ProcessTextEntry.mjs');
    ProcessTextEntry = module.ProcessTextEntry;
  });

  describe('constructor', () => {
    it('should throw if messagingGateway is not provided', () => {
      expect(() => new ProcessTextEntry({ aiGateway: mockAiGateway })).toThrow(
        'messagingGateway is required'
      );
    });

    it('should throw if aiGateway is not provided', () => {
      expect(() => new ProcessTextEntry({ messagingGateway: mockMessagingGateway })).toThrow(
        'aiGateway is required'
      );
    });

    it('should create instance with required dependencies', () => {
      const instance = new ProcessTextEntry({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
      });
      expect(instance).toBeInstanceOf(ProcessTextEntry);
    });

    it('should create instance with all dependencies', () => {
      const instance = new ProcessTextEntry({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        conversationStateStore: mockConversationStateStore,
        logger: mockLogger,
      });
      expect(instance).toBeInstanceOf(ProcessTextEntry);
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      useCase = new ProcessTextEntry({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        conversationStateStore: mockConversationStateStore,
        logger: mockLogger,
      });
    });

    it('should save user message to journal entry repository', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "Got it!", "question": "How did that make you feel?"}')
        .mockResolvedValueOnce('["Happy", "Sad", "Neutral"]');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'Today was a great day',
        messageId: 'msg-001',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(mockJournalEntryRepository.saveMessage).toHaveBeenCalled();
      const savedMessage = mockJournalEntryRepository.saveMessage.mock.calls[0][0];
      expect(savedMessage.chatId).toBe('chat-123');
      expect(savedMessage.text).toBe('Today was a great day');
      expect(savedMessage.senderId).toBe('user-456');
      expect(savedMessage.senderName).toBe('John');
    });

    it('should load conversation history for context', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "I see", "question": "What happened?"}')
        .mockResolvedValueOnce('["Work", "Family", "Other"]');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'Had a rough morning',
        messageId: 'msg-002',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(mockJournalEntryRepository.getMessageHistory).toHaveBeenCalledWith('chat-123', 100);
    });

    it('should generate conversational response via AI gateway', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "That sounds challenging", "question": "What made it difficult?"}')
        .mockResolvedValueOnce('["Time pressure", "Complexity", "Resources"]');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'The project deadline is stressful',
        messageId: 'msg-003',
        senderId: 'user-456',
        senderName: 'John',
      });

      // First call is for conversational response
      expect(mockAiGateway.chat).toHaveBeenCalledTimes(2);
      expect(mockAiGateway.chat.mock.calls[0][1]).toEqual({ maxTokens: 150 });
    });

    it('should generate multiple choice options for follow-up', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "I understand", "question": "Would you like to talk about it?"}')
        .mockResolvedValueOnce('["Yes, definitely", "Maybe later", "Not really"]');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'Something happened at work',
        messageId: 'msg-004',
        senderId: 'user-456',
        senderName: 'John',
      });

      // Second call is for generating choices
      expect(mockAiGateway.chat).toHaveBeenCalledTimes(2);
      expect(mockAiGateway.chat.mock.calls[1][1]).toEqual({ maxTokens: 100 });
    });

    it('should send combined acknowledgment and question message', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "That must have been exciting!", "question": "What was the best part?"}')
        .mockResolvedValueOnce('["The people", "The experience", "The outcome"]');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'I got promoted today!',
        messageId: 'msg-005',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        'That must have been exciting!\n\nWhat was the best part?',
        expect.objectContaining({ choices: expect.any(Array) })
      );
    });

    it('should send question only when acknowledgment is empty', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "", "question": "What happened next?"}')
        .mockResolvedValueOnce('["It continued", "It stopped", "Something else"]');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'Then I saw something unusual',
        messageId: 'msg-006',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        'What happened next?',
        expect.objectContaining({ choices: expect.any(Array) })
      );
    });

    it('should save bot response to journal entry repository', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "Interesting!", "question": "Tell me more"}')
        .mockResolvedValueOnce('["Sure", "Maybe", "No"]');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'I met someone new',
        messageId: 'msg-007',
        senderId: 'user-456',
        senderName: 'John',
      });

      // Should be called twice: once for user message, once for bot message
      expect(mockJournalEntryRepository.saveMessage).toHaveBeenCalledTimes(2);
      const botMessage = mockJournalEntryRepository.saveMessage.mock.calls[1][0];
      expect(botMessage.senderId).toBe('bot');
      expect(botMessage.text).toContain('Interesting!');
      expect(botMessage.text).toContain('Tell me more');
    });

    it('should return success with response details', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "Noted", "question": "How do you feel?"}')
        .mockResolvedValueOnce('["Good", "Bad", "Neutral"]');

      const result = await useCase.execute({
        chatId: 'chat-123',
        text: 'Just checking in',
        messageId: 'msg-008',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(result).toEqual({
        success: true,
        messageId: 'sent-msg-123',
        acknowledgment: 'Noted',
        question: 'How do you feel?',
      });
    });

    it('should format choices as keyboard with number emojis', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "OK", "question": "Which one?"}')
        .mockResolvedValueOnce('["Option A", "Option B", "Option C"]');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'I need to decide',
        messageId: 'msg-009',
        senderId: 'user-456',
        senderName: 'John',
      });

      const sentChoices = mockMessagingGateway.sendMessage.mock.calls[0][2].choices;
      expect(sentChoices).toContainEqual(['1\uFE0F\u20E3 Option A']);
      expect(sentChoices).toContainEqual(['2\uFE0F\u20E3 Option B']);
      expect(sentChoices).toContainEqual(['3\uFE0F\u20E3 Option C']);
    });

    it('should include Change Subject and Cancel buttons in choices', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "Got it", "question": "What else?"}')
        .mockResolvedValueOnce('["This", "That"]');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'Testing controls',
        messageId: 'msg-010',
        senderId: 'user-456',
        senderName: 'John',
      });

      const sentChoices = mockMessagingGateway.sendMessage.mock.calls[0][2].choices;
      expect(sentChoices).toContainEqual(['\uD83C\uDFB2 Change Subject', '\u274C Cancel']);
    });

    it('should log debug on start and info on completion', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "OK", "question": "What now?"}')
        .mockResolvedValueOnce('["A", "B"]');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'Log test',
        messageId: 'msg-011',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith('textEntry.process.start', {
        chatId: 'chat-123',
        textLength: 8,
      });
      expect(mockLogger.info).toHaveBeenCalledWith('textEntry.process.complete', {
        chatId: 'chat-123',
      });
    });
  });

  describe('execute - fallback behavior', () => {
    beforeEach(() => {
      useCase = new ProcessTextEntry({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        conversationStateStore: mockConversationStateStore,
        logger: mockLogger,
      });
    });

    it('should send fallback "Noted" message when AI returns no JSON', async () => {
      mockAiGateway.chat.mockResolvedValueOnce('I could not generate a response');

      const result = await useCase.execute({
        chatId: 'chat-123',
        text: 'Some entry',
        messageId: 'msg-012',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        '\uD83D\uDCDD Noted.',
        {}
      );
      expect(result).toEqual({ success: true, messageId: 'sent-msg-123' });
    });

    it('should send fallback when AI response has no question field', async () => {
      mockAiGateway.chat.mockResolvedValueOnce('{"acknowledgment": "OK", "other": "data"}');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'Another entry',
        messageId: 'msg-013',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        '\uD83D\uDCDD Noted.',
        {}
      );
    });

    it('should use default choices when AI choice generation fails', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "OK", "question": "How are you?"}')
        .mockResolvedValueOnce('invalid json');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'Choice fallback test',
        messageId: 'msg-014',
        senderId: 'user-456',
        senderName: 'John',
      });

      const sentChoices = mockMessagingGateway.sendMessage.mock.calls[0][2].choices;
      expect(sentChoices).toContainEqual(['1\uFE0F\u20E3 Yes']);
      expect(sentChoices).toContainEqual(['2\uFE0F\u20E3 No']);
      expect(sentChoices).toContainEqual(['3\uFE0F\u20E3 Tell me more']);
    });

    it('should use default choices when AI returns too few options', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "OK", "question": "Ready?"}')
        .mockResolvedValueOnce('["Only one"]');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'Few options test',
        messageId: 'msg-015',
        senderId: 'user-456',
        senderName: 'John',
      });

      const sentChoices = mockMessagingGateway.sendMessage.mock.calls[0][2].choices;
      // Should fall back to default choices
      expect(sentChoices).toContainEqual(['1\uFE0F\u20E3 Yes']);
    });
  });

  describe('execute - conversation state context', () => {
    beforeEach(() => {
      useCase = new ProcessTextEntry({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        conversationStateStore: mockConversationStateStore,
        logger: mockLogger,
      });
    });

    it('should load debrief summary from conversation state if available', async () => {
      mockConversationStateStore.get.mockResolvedValueOnce({
        debrief: { summary: 'User had a busy morning with meetings' },
      });
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "I see", "question": "How did the meetings go?"}')
        .mockResolvedValueOnce('["Well", "Poorly", "Mixed"]');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'Checking in after meetings',
        messageId: 'msg-016',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(mockConversationStateStore.get).toHaveBeenCalledWith('chat-123');
    });

    it('should work without conversation state store', async () => {
      const useCaseNoState = new ProcessTextEntry({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        logger: mockLogger,
      });

      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "OK", "question": "What next?"}')
        .mockResolvedValueOnce('["This", "That"]');

      const result = await useCaseNoState.execute({
        chatId: 'chat-123',
        text: 'No state store',
        messageId: 'msg-017',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('execute - error handling', () => {
    beforeEach(() => {
      useCase = new ProcessTextEntry({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        conversationStateStore: mockConversationStateStore,
        logger: mockLogger,
      });
    });

    it('should fall back to "Noted" when AI response generation fails', async () => {
      // AI chat errors are caught internally and fall back to "Noted"
      const testError = new Error('AI service unavailable');
      mockAiGateway.chat.mockRejectedValueOnce(testError);

      const result = await useCase.execute({
        chatId: 'chat-123',
        text: 'This will use fallback',
        messageId: 'msg-018',
        senderId: 'user-456',
        senderName: 'John',
      });

      // Should fall back gracefully with "Noted" message
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        '\uD83D\uDCDD Noted.',
        {}
      );
      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith('textEntry.conversational.parseFailed', {
        error: 'AI service unavailable',
      });
    });

    it('should log error and rethrow when messaging gateway fails', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "OK", "question": "Test?"}')
        .mockResolvedValueOnce('["A", "B"]');
      mockMessagingGateway.sendMessage.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        useCase.execute({
          chatId: 'chat-123',
          text: 'Messaging will fail',
          messageId: 'msg-019',
          senderId: 'user-456',
          senderName: 'John',
        })
      ).rejects.toThrow('Network error');

      expect(mockLogger.error).toHaveBeenCalledWith('textEntry.process.error', {
        chatId: 'chat-123',
        error: 'Network error',
      });
    });

    it('should log error and rethrow when journal save fails', async () => {
      mockJournalEntryRepository.saveMessage.mockRejectedValueOnce(
        new Error('Database unavailable')
      );

      await expect(
        useCase.execute({
          chatId: 'chat-123',
          text: 'Save will fail',
          messageId: 'msg-020',
          senderId: 'user-456',
          senderName: 'John',
        })
      ).rejects.toThrow('Database unavailable');

      expect(mockLogger.error).toHaveBeenCalledWith('textEntry.process.error', {
        chatId: 'chat-123',
        error: 'Database unavailable',
      });
    });
  });

  describe('execute - without optional repositories', () => {
    it('should work without journalEntryRepository', async () => {
      const minimalUseCase = new ProcessTextEntry({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        logger: mockLogger,
      });

      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "Noted", "question": "How so?"}')
        .mockResolvedValueOnce('["This way", "That way"]');

      const result = await minimalUseCase.execute({
        chatId: 'chat-123',
        text: 'Minimal test',
        messageId: 'msg-020',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(result.success).toBe(true);
    });

    it('should return empty history when repository has no getMessageHistory', async () => {
      const repoWithoutHistory = {
        saveMessage: jest.fn(),
        // No getMessageHistory method
      };

      const useCasePartialRepo = new ProcessTextEntry({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: repoWithoutHistory,
        logger: mockLogger,
      });

      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "OK", "question": "What?"}')
        .mockResolvedValueOnce('["A", "B"]');

      const result = await useCasePartialRepo.execute({
        chatId: 'chat-123',
        text: 'No history method',
        messageId: 'msg-021',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('execute - JSON parsing from markdown code blocks', () => {
    beforeEach(() => {
      useCase = new ProcessTextEntry({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        logger: mockLogger,
      });
    });

    it('should extract JSON from markdown code block', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('```json\n{"acknowledgment": "Great!", "question": "What else?"}\n```')
        .mockResolvedValueOnce('["More", "Less"]');

      const result = await useCase.execute({
        chatId: 'chat-123',
        text: 'Markdown JSON test',
        messageId: 'msg-022',
        senderId: 'user-456',
        senderName: 'John',
      });

      expect(result.acknowledgment).toBe('Great!');
      expect(result.question).toBe('What else?');
    });

    it('should extract choices array from markdown code block', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "OK", "question": "Pick one"}')
        .mockResolvedValueOnce('Here are options:\n```\n["First", "Second", "Third"]\n```');

      await useCase.execute({
        chatId: 'chat-123',
        text: 'Choices in markdown',
        messageId: 'msg-023',
        senderId: 'user-456',
        senderName: 'John',
      });

      const sentChoices = mockMessagingGateway.sendMessage.mock.calls[0][2].choices;
      expect(sentChoices).toContainEqual(['1\uFE0F\u20E3 First']);
      expect(sentChoices).toContainEqual(['2\uFE0F\u20E3 Second']);
      expect(sentChoices).toContainEqual(['3\uFE0F\u20E3 Third']);
    });
  });
});
