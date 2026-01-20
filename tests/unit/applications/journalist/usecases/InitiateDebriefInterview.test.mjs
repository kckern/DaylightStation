// tests/unit/applications/journalist/usecases/InitiateDebriefInterview.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('InitiateDebriefInterview', () => {
  let InitiateDebriefInterview;
  let useCase;
  let mockMessagingGateway;
  let mockAiGateway;
  let mockJournalEntryRepository;
  let mockMessageQueueRepository;
  let mockDebriefRepository;
  let mockConversationStateStore;
  let mockUserResolver;
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
      clearQueue: jest.fn().mockResolvedValue(undefined),
    };

    mockDebriefRepository = {
      getRecentDebriefs: jest.fn().mockResolvedValue([]),
      getDebriefByDate: jest.fn().mockResolvedValue(null),
    };

    mockConversationStateStore = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    mockUserResolver = {
      resolveUsername: jest.fn().mockReturnValue('testuser'),
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Dynamic import after mocks are set up
    const module = await import(
      '../../../../../backend/src/3_applications/journalist/usecases/InitiateDebriefInterview.mjs'
    );
    InitiateDebriefInterview = module.InitiateDebriefInterview;
  });

  describe('constructor', () => {
    it('should throw if messagingGateway is not provided', () => {
      expect(() => new InitiateDebriefInterview({ aiGateway: mockAiGateway })).toThrow(
        'messagingGateway is required'
      );
    });

    it('should throw if aiGateway is not provided', () => {
      expect(() => new InitiateDebriefInterview({ messagingGateway: mockMessagingGateway })).toThrow(
        'aiGateway is required'
      );
    });

    it('should create instance with required dependencies', () => {
      const instance = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
      });
      expect(instance).toBeInstanceOf(InitiateDebriefInterview);
    });

    it('should create instance with all dependencies', () => {
      const instance = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        debriefRepository: mockDebriefRepository,
        conversationStateStore: mockConversationStateStore,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
      expect(instance).toBeInstanceOf(InitiateDebriefInterview);
    });
  });

  describe('execute - generate and send interview question', () => {
    beforeEach(() => {
      useCase = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        debriefRepository: mockDebriefRepository,
        conversationStateStore: mockConversationStateStore,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should generate interview question based on debrief via AI', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'You walked 10k steps and had a productive day.',
          summaries: [{ text: 'Walked 10,000 steps' }],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('How did you feel during your morning walk?')
        .mockResolvedValueOnce('["Energized", "Tired", "Neutral", "Refreshed"]');

      const result = await useCase.execute({
        conversationId: 'chat-123',
      });

      expect(result.success).toBe(true);
      expect(result.question).toBe('How did you feel during your morning walk?');
      expect(mockAiGateway.chat).toHaveBeenCalledTimes(2);
    });

    it('should send formatted question with choices to user', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Active day summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('What was the highlight of your day?')
        .mockResolvedValueOnce('["Work", "Exercise", "Family time", "Something else"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        expect.stringContaining('What was the highlight of your day?'),
        expect.objectContaining({ choices: expect.any(Array) })
      );
    });

    it('should fetch debrief by specific date when provided', async () => {
      mockDebriefRepository.getDebriefByDate.mockResolvedValue({
        date: '2024-01-10',
        summary: 'Specific date summary.',
        summaries: [],
      });

      mockAiGateway.chat
        .mockResolvedValueOnce('Tell me about that day?')
        .mockResolvedValueOnce('["Great", "Okay", "Not good", "Mixed"]');

      await useCase.execute({
        conversationId: 'chat-123',
        debriefDate: '2024-01-10',
      });

      expect(mockDebriefRepository.getDebriefByDate).toHaveBeenCalledWith('2024-01-10');
      expect(mockDebriefRepository.getRecentDebriefs).not.toHaveBeenCalled();
    });

    it('should save bot message to journal entry repository', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Good day.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('How was your sleep?')
        .mockResolvedValueOnce('["Great", "Poor", "Average", "Restless"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      expect(mockJournalEntryRepository.saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sent-msg-123',
          chatId: 'chat-123',
          role: 'assistant',
          senderId: 'bot',
          senderName: 'Journalist',
        })
      );
    });

    it('should clear existing message queue before sending new question', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      expect(mockMessageQueueRepository.clearQueue).toHaveBeenCalledWith('chat-123');
    });

    it('should use fallback question when AI returns empty response', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('') // Empty response for question
        .mockResolvedValueOnce('["Yes", "No", "Maybe", "Not sure"]');

      const result = await useCase.execute({
        conversationId: 'chat-123',
      });

      expect(result.question).toBe('Tell me more about your day.');
    });

    it('should return messageId in result', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      const result = await useCase.execute({
        conversationId: 'chat-123',
      });

      expect(result.messageId).toBe('sent-msg-123');
    });
  });

  describe('execute - track asked questions in conversation state', () => {
    beforeEach(() => {
      useCase = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        debriefRepository: mockDebriefRepository,
        conversationStateStore: mockConversationStateStore,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should update state with asked question after sending', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockConversationStateStore.get.mockResolvedValue({
        flowState: { askedQuestions: [] },
      });

      mockAiGateway.chat
        .mockResolvedValueOnce('What motivated you today?')
        .mockResolvedValueOnce('["Work", "Health", "Family", "Other"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      expect(mockConversationStateStore.set).toHaveBeenCalledWith(
        'chat-123',
        expect.objectContaining({
          activeFlow: 'morning_debrief',
          flowState: expect.objectContaining({
            lastQuestion: 'What motivated you today?',
            askedQuestions: expect.arrayContaining(['What motivated you today?']),
            lastMessageId: 'sent-msg-123',
          }),
        })
      );
    });

    it('should preserve existing asked questions when adding new one', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockConversationStateStore.get.mockResolvedValue({
        flowState: {
          askedQuestions: ['Previous question?', 'Another question?'],
          debrief: { date: '2024-01-15' },
        },
      });

      mockAiGateway.chat
        .mockResolvedValueOnce('New question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      expect(mockConversationStateStore.set).toHaveBeenCalledWith(
        'chat-123',
        expect.objectContaining({
          flowState: expect.objectContaining({
            askedQuestions: expect.arrayContaining([
              'Previous question?',
              'Another question?',
              'New question?',
            ]),
          }),
        })
      );
    });

    it('should limit asked questions to last 5', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockConversationStateStore.get.mockResolvedValue({
        flowState: {
          askedQuestions: ['Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?'],
        },
      });

      mockAiGateway.chat
        .mockResolvedValueOnce('Q6?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      const setCall = mockConversationStateStore.set.mock.calls[0][1];
      expect(setCall.flowState.askedQuestions.length).toBeLessThanOrEqual(5);
      expect(setCall.flowState.askedQuestions).toContain('Q6?');
    });

    it('should add previousQuestion to askedQuestions if provided', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockConversationStateStore.get.mockResolvedValue({
        flowState: { askedQuestions: ['Existing?'] },
      });

      mockAiGateway.chat
        .mockResolvedValueOnce('New question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
        previousQuestion: 'Skipped question?',
      });

      // The previousQuestion should be used in prompt building
      expect(mockAiGateway.chat).toHaveBeenCalled();
      const firstCallPrompt = mockAiGateway.chat.mock.calls[0][0][0].content;
      expect(firstCallPrompt).toContain('Skipped question?');
    });
  });

  describe('execute - avoid repeating recent questions', () => {
    beforeEach(() => {
      useCase = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        debriefRepository: mockDebriefRepository,
        conversationStateStore: mockConversationStateStore,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should include previously asked questions in AI prompt to avoid repetition', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockConversationStateStore.get.mockResolvedValue({
        flowState: {
          askedQuestions: ['How was your workout?', 'What did you eat?'],
        },
      });

      mockAiGateway.chat
        .mockResolvedValueOnce('Different question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      const aiPrompt = mockAiGateway.chat.mock.calls[0][0][0].content;
      expect(aiPrompt).toContain('How was your workout?');
      expect(aiPrompt).toContain('What did you eat?');
      expect(aiPrompt).toContain('DO NOT repeat');
    });

    it('should include change_subject instructions when specified', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockConversationStateStore.get.mockResolvedValue({
        flowState: { askedQuestions: [] },
      });

      mockAiGateway.chat
        .mockResolvedValueOnce('Different topic question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
        instructions: 'change_subject',
      });

      const aiPrompt = mockAiGateway.chat.mock.calls[0][0][0].content;
      expect(aiPrompt).toContain('DIFFERENT topic');
    });

    it('should not include repetition avoidance when no previous questions', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockConversationStateStore.get.mockResolvedValue({
        flowState: { askedQuestions: [] },
      });

      mockAiGateway.chat
        .mockResolvedValueOnce('First question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      const aiPrompt = mockAiGateway.chat.mock.calls[0][0][0].content;
      expect(aiPrompt).not.toContain('PREVIOUSLY ASKED QUESTIONS');
    });
  });

  describe('execute - handle missing debrief state', () => {
    beforeEach(() => {
      useCase = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        debriefRepository: mockDebriefRepository,
        conversationStateStore: mockConversationStateStore,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should send error message when no debrief found', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([]);

      const result = await useCase.execute({
        conversationId: 'chat-123',
      });

      expect(result.success).toBe(false);
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        'No debrief found to interview about.'
      );
    });

    it('should return success=false when debrief by date returns null', async () => {
      mockDebriefRepository.getDebriefByDate.mockResolvedValue(null);

      const result = await useCase.execute({
        conversationId: 'chat-123',
        debriefDate: '2024-01-01',
      });

      expect(result.success).toBe(false);
      expect(mockAiGateway.chat).not.toHaveBeenCalled();
    });

    it('should work without conversation state store', async () => {
      const useCaseNoState = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        debriefRepository: mockDebriefRepository,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });

      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      const result = await useCaseNoState.execute({
        conversationId: 'chat-123',
      });

      expect(result.success).toBe(true);
    });

    it('should work without message queue repository', async () => {
      const useCaseNoQueue = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        debriefRepository: mockDebriefRepository,
        conversationStateStore: mockConversationStateStore,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });

      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      const result = await useCaseNoQueue.execute({
        conversationId: 'chat-123',
      });

      expect(result.success).toBe(true);
    });

    it('should work without journal entry repository', async () => {
      const useCaseNoJournal = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        debriefRepository: mockDebriefRepository,
        conversationStateStore: mockConversationStateStore,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });

      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      const result = await useCaseNoJournal.execute({
        conversationId: 'chat-123',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('execute - error handling', () => {
    beforeEach(() => {
      useCase = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        debriefRepository: mockDebriefRepository,
        conversationStateStore: mockConversationStateStore,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should log error and rethrow when AI gateway fails', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat.mockRejectedValueOnce(new Error('AI service unavailable'));

      await expect(
        useCase.execute({
          conversationId: 'chat-123',
        })
      ).rejects.toThrow('AI service unavailable');

      expect(mockLogger.error).toHaveBeenCalledWith('debriefInterview.initiate.error', {
        conversationId: 'chat-123',
        error: 'AI service unavailable',
      });
    });

    it('should log error and rethrow when messaging gateway fails', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      mockMessagingGateway.sendMessage.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        useCase.execute({
          conversationId: 'chat-123',
        })
      ).rejects.toThrow('Network error');

      expect(mockLogger.error).toHaveBeenCalledWith('debriefInterview.initiate.error', {
        conversationId: 'chat-123',
        error: 'Network error',
      });
    });

    it('should use fallback choices when AI choice generation fails', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('invalid json response');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      const sentChoices = mockMessagingGateway.sendMessage.mock.calls[0][2].choices;
      // Should have default fallback choices
      expect(sentChoices).toContainEqual(['1\uFE0F\u20E3 Yes']);
      expect(sentChoices).toContainEqual(['2\uFE0F\u20E3 No']);
    });

    it('should use fallback choices when AI returns too few options', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["Only one"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      const sentChoices = mockMessagingGateway.sendMessage.mock.calls[0][2].choices;
      // Should have default fallback choices
      expect(sentChoices).toContainEqual(['1\uFE0F\u20E3 Yes']);
    });
  });

  describe('execute - logging', () => {
    beforeEach(() => {
      useCase = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        debriefRepository: mockDebriefRepository,
        conversationStateStore: mockConversationStateStore,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should log debug on start', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
        debriefDate: '2024-01-15',
        instructions: 'change_subject',
        previousQuestion: 'Old question?',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith('debriefInterview.initiate.start', {
        conversationId: 'chat-123',
        debriefDate: '2024-01-15',
        instructions: 'change_subject',
        previousQuestion: 'Old question?',
      });
    });

    it('should log info on completion', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('debriefInterview.initiate.complete', {
        conversationId: 'chat-123',
        messageId: 'sent-msg-123',
      });
    });
  });

  describe('execute - debrief context building', () => {
    beforeEach(() => {
      useCase = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        debriefRepository: mockDebriefRepository,
        conversationStateStore: mockConversationStateStore,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should include debrief date and summary in AI prompt', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'You had a productive day with 10k steps.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      const aiPrompt = mockAiGateway.chat.mock.calls[0][0][0].content;
      expect(aiPrompt).toContain('2024-01-15');
      expect(aiPrompt).toContain('You had a productive day with 10k steps.');
    });

    it('should include detailed summaries in AI prompt', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [
            { text: 'Walked 10,000 steps' },
            { text: 'Made 5 commits to project' },
          ],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      const aiPrompt = mockAiGateway.chat.mock.calls[0][0][0].content;
      expect(aiPrompt).toContain('Walked 10,000 steps');
      expect(aiPrompt).toContain('Made 5 commits to project');
    });

    it('should include conversation history in AI prompt when available', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockJournalEntryRepository.getMessageHistory.mockResolvedValue([
        {
          timestamp: '2024-01-15T10:00:00Z',
          senderName: 'User',
          text: 'I went for a walk this morning.',
        },
        {
          timestamp: '2024-01-15T10:01:00Z',
          senderName: 'Journalist',
          text: 'How did it feel?',
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      expect(mockJournalEntryRepository.getMessageHistory).toHaveBeenCalledWith('chat-123', 20);
    });
  });

  describe('execute - choices generation', () => {
    beforeEach(() => {
      useCase = new InitiateDebriefInterview({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAiGateway,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        debriefRepository: mockDebriefRepository,
        conversationStateStore: mockConversationStateStore,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should format choices with number emojis', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["Option A", "Option B", "Option C", "Option D"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      const sentChoices = mockMessagingGateway.sendMessage.mock.calls[0][2].choices;
      expect(sentChoices).toContainEqual(['1\uFE0F\u20E3 Option A']);
      expect(sentChoices).toContainEqual(['2\uFE0F\u20E3 Option B']);
      expect(sentChoices).toContainEqual(['3\uFE0F\u20E3 Option C']);
      expect(sentChoices).toContainEqual(['4\uFE0F\u20E3 Option D']);
    });

    it('should include Change Subject and Cancel control buttons', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('["A", "B", "C", "D"]');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      const sentChoices = mockMessagingGateway.sendMessage.mock.calls[0][2].choices;
      expect(sentChoices).toContainEqual(['\uD83C\uDFB2 Change Subject', '\u274C Cancel']);
    });

    it('should extract JSON from markdown code block', async () => {
      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summary: 'Summary.',
          summaries: [],
        },
      ]);

      mockAiGateway.chat
        .mockResolvedValueOnce('Question?')
        .mockResolvedValueOnce('Here are the options:\n```json\n["First", "Second", "Third", "Fourth"]\n```');

      await useCase.execute({
        conversationId: 'chat-123',
      });

      const sentChoices = mockMessagingGateway.sendMessage.mock.calls[0][2].choices;
      expect(sentChoices).toContainEqual(['1\uFE0F\u20E3 First']);
      expect(sentChoices).toContainEqual(['2\uFE0F\u20E3 Second']);
    });
  });
});
