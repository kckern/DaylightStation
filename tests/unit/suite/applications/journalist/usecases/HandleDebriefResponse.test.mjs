// tests/unit/applications/journalist/usecases/HandleDebriefResponse.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('HandleDebriefResponse', () => {
  let HandleDebriefResponse;
  let useCase;
  let mockMessagingGateway;
  let mockConversationStateStore;
  let mockDebriefRepository;
  let mockJournalEntryRepository;
  let mockUserResolver;
  let mockLogger;

  beforeEach(async () => {
    // Reset mocks
    mockMessagingGateway = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: 'sent-msg-123' }),
      updateKeyboard: jest.fn().mockResolvedValue(undefined),
    };

    mockConversationStateStore = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    mockDebriefRepository = {
      getRecentDebriefs: jest.fn().mockResolvedValue([]),
    };

    mockJournalEntryRepository = {
      saveMessage: jest.fn().mockResolvedValue(undefined),
      deleteMessage: jest.fn().mockResolvedValue(undefined),
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
    const module = await import('#backend/src/3_applications/journalist/usecases/HandleDebriefResponse.mjs');
    HandleDebriefResponse = module.HandleDebriefResponse;
  });

  describe('constructor', () => {
    it('should create instance with required dependencies', () => {
      const instance = new HandleDebriefResponse({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockConversationStateStore,
        debriefRepository: mockDebriefRepository,
        journalEntryRepository: mockJournalEntryRepository,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
      expect(instance).toBeInstanceOf(HandleDebriefResponse);
    });

    it('should create instance without optional logger', () => {
      const instance = new HandleDebriefResponse({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockConversationStateStore,
        debriefRepository: mockDebriefRepository,
        journalEntryRepository: mockJournalEntryRepository,
        userResolver: mockUserResolver,
      });
      expect(instance).toBeInstanceOf(HandleDebriefResponse);
    });
  });

  describe('execute - Show Details action', () => {
    beforeEach(() => {
      useCase = new HandleDebriefResponse({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockConversationStateStore,
        debriefRepository: mockDebriefRepository,
        journalEntryRepository: mockJournalEntryRepository,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should transition to source_picker subFlow when "Show Details" is pressed', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
      });

      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summaries: [
            { source: 'garmin', category: 'fitness', text: 'You walked 10k steps' },
            { source: 'github', category: 'code', text: '5 commits made' },
          ],
        },
      ]);

      const result = await useCase.execute({
        conversationId: 'chat-123',
        text: '📊 Details',
        messageId: 'msg-001',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('show_details');
      expect(result.sources).toContain('garmin');
      expect(result.sources).toContain('github');

      // Should update state to source_picker mode
      expect(mockConversationStateStore.set).toHaveBeenCalledWith(
        'chat-123',
        expect.objectContaining({
          subFlow: 'source_picker',
          debriefDate: '2024-01-15',
        })
      );
    });

    it('should update existing keyboard when messageId is provided', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
      });

      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summaries: [{ source: 'events', category: 'calendar', text: 'Meeting at 3pm' }],
        },
      ]);

      await useCase.execute({
        conversationId: 'chat-123',
        text: '📊 Details',
        messageId: 'existing-msg-id',
      });

      expect(mockMessagingGateway.updateKeyboard).toHaveBeenCalledWith(
        'chat-123',
        'existing-msg-id',
        expect.any(Array) // inline_keyboard array
      );
    });

    it('should send new message when no messageId is provided', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
      });

      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summaries: ['garmin', 'strava'], // test string format too
        },
      ]);

      await useCase.execute({
        conversationId: 'chat-123',
        text: '📊 Details',
      });

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        'Select a data source to view details:',
        expect.objectContaining({ reply_markup: expect.any(Object) })
      );
    });

    it('should return empty result when no debrief data found', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
      });

      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([]);

      const result = await useCase.execute({
        conversationId: 'chat-123',
        text: '📊 Details',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('show_details');
      expect(result.empty).toBe(true);

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        'No debrief data found.'
      );
    });

    it('should return empty result when debrief has no summaries', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
      });

      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summaries: [],
        },
      ]);

      const result = await useCase.execute({
        conversationId: 'chat-123',
        text: '📊 Details',
      });

      expect(result.handled).toBe(true);
      expect(result.empty).toBe(true);

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        'No detailed data sources available for this debrief.'
      );
    });

    it('should save message to journal when sending new message', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
      });

      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summaries: [{ source: 'fitness' }],
        },
      ]);

      await useCase.execute({
        conversationId: 'chat-123',
        text: '📊 Details',
      });

      expect(mockJournalEntryRepository.saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sent-msg-123',
          chatId: 'chat-123',
          role: 'assistant',
          content: 'Select a data source to view details:',
          senderId: 'bot',
          senderName: 'Journalist',
        })
      );
    });
  });

  describe('execute - Ask Me action', () => {
    beforeEach(() => {
      useCase = new HandleDebriefResponse({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockConversationStateStore,
        debriefRepository: mockDebriefRepository,
        journalEntryRepository: mockJournalEntryRepository,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should transition to interview subFlow when "Ask Me" is pressed', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: {
          date: '2024-01-15',
          categories: [
            { key: 'fitness', icon: '🏃' },
            { key: 'work', icon: '💼' },
          ],
          questions: {
            fitness: ['How did you feel during your workout?', 'What was most challenging?'],
            work: ['What was the highlight of your workday?'],
          },
        },
      });

      const result = await useCase.execute({
        conversationId: 'chat-123',
        text: '💬 Ask',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('ask_me');
      expect(result.category).toBe('fitness');

      // Should send first question
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        '🏃 How did you feel during your workout?',
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.arrayContaining([
              [{ text: '🎲 Different question', callback_data: 'journal:change' }],
            ]),
          }),
        })
      );

      // Should update state to interview mode
      expect(mockConversationStateStore.set).toHaveBeenCalledWith(
        'chat-123',
        expect.objectContaining({
          subFlow: 'interview',
          currentCategory: 'fitness',
          currentQuestionIndex: 0,
          askedCategories: ['fitness'],
        })
      );
    });

    it('should send fallback question when no questions available', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: {
          date: '2024-01-15',
          categories: [],
          questions: {},
        },
      });

      const result = await useCase.execute({
        conversationId: 'chat-123',
        text: '💬 Ask',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('ask_me');
      expect(result.fallback).toBe(true);

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        'What stood out most about yesterday?',
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.arrayContaining([
              [{ text: '🎲 Different question', callback_data: 'journal:change' }],
              [{ text: '✅ Done', callback_data: 'journal:done' }],
            ]),
          }),
        })
      );
    });

    it('should skip categories with empty question arrays', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: {
          date: '2024-01-15',
          categories: [
            { key: 'fitness', icon: '🏃' },
            { key: 'work', icon: '💼' },
          ],
          questions: {
            fitness: [], // empty
            work: ['What did you accomplish at work?'],
          },
        },
      });

      const result = await useCase.execute({
        conversationId: 'chat-123',
        text: '💬 Ask',
      });

      expect(result.category).toBe('work');
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        '💼 What did you accomplish at work?',
        expect.any(Object)
      );
    });

    it('should save interview question to journal', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: {
          date: '2024-01-15',
          categories: [{ key: 'health', icon: '❤️' }],
          questions: {
            health: ['How are you feeling today?'],
          },
        },
      });

      await useCase.execute({
        conversationId: 'chat-123',
        text: '💬 Ask',
      });

      expect(mockJournalEntryRepository.saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sent-msg-123',
          chatId: 'chat-123',
          role: 'assistant',
          content: '❤️ How are you feeling today?',
          senderId: 'bot',
          senderName: 'Journalist',
        })
      );
    });
  });

  describe('execute - Accept action', () => {
    beforeEach(() => {
      useCase = new HandleDebriefResponse({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockConversationStateStore,
        debriefRepository: mockDebriefRepository,
        journalEntryRepository: mockJournalEntryRepository,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should transition to free_write flow and remove keyboard when "Accept" is pressed', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
        messageId: 'debrief-msg-001',
      });

      const result = await useCase.execute({
        conversationId: 'chat-123',
        text: '✅ OK',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('accept');

      // Should send confirmation with keyboard removed
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        '✓ Got it. Feel free to write anything on your mind, or just go about your day.',
        { reply_markup: { remove_keyboard: true } }
      );

      // Should update state to free_write
      expect(mockConversationStateStore.set).toHaveBeenCalledWith(
        'chat-123',
        expect.objectContaining({
          activeFlow: 'free_write',
          debriefAccepted: true,
          acceptedAt: expect.any(String),
        })
      );
    });

    it('should delete debrief message from history when accepting', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
        messageId: 'debrief-msg-001',
        detailsMessageId: 'details-msg-002',
      });

      await useCase.execute({
        conversationId: 'chat-123',
        text: '✅ OK',
      });

      expect(mockJournalEntryRepository.deleteMessage).toHaveBeenCalledWith(
        'chat-123',
        'debrief-msg-001'
      );
      expect(mockJournalEntryRepository.deleteMessage).toHaveBeenCalledWith(
        'chat-123',
        'details-msg-002'
      );
    });

    it('should not fail when no messageId or detailsMessageId in state', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
      });

      const result = await useCase.execute({
        conversationId: 'chat-123',
        text: '✅ OK',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('accept');
      expect(mockJournalEntryRepository.deleteMessage).not.toHaveBeenCalled();
    });

    it('should log acceptance with date', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
      });

      await useCase.execute({
        conversationId: 'chat-123',
        text: '✅ OK',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('debrief.accepted', {
        conversationId: 'chat-123',
        date: '2024-01-15',
      });
    });
  });

  describe('execute - error handling', () => {
    beforeEach(() => {
      useCase = new HandleDebriefResponse({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockConversationStateStore,
        debriefRepository: mockDebriefRepository,
        journalEntryRepository: mockJournalEntryRepository,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should return handled=false for invalid/unknown button text', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
      });

      const result = await useCase.execute({
        conversationId: 'chat-123',
        text: 'Some random text',
      });

      expect(result.handled).toBe(false);
    });

    it('should return handled=false when no active debrief state', async () => {
      mockConversationStateStore.get.mockResolvedValue(null);

      const result = await useCase.execute({
        conversationId: 'chat-123',
        text: '📊 Details',
      });

      expect(result.handled).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith('debrief.response.no-active-debrief', {
        conversationId: 'chat-123',
      });
    });

    it('should return handled=false when activeFlow is not morning_debrief', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'free_write', // different flow
        debrief: { date: '2024-01-15' },
      });

      const result = await useCase.execute({
        conversationId: 'chat-123',
        text: '📊 Details',
      });

      expect(result.handled).toBe(false);
    });
  });

  describe('execute - logging', () => {
    beforeEach(() => {
      useCase = new HandleDebriefResponse({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockConversationStateStore,
        debriefRepository: mockDebriefRepository,
        journalEntryRepository: mockJournalEntryRepository,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });
    });

    it('should log when response is received', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
      });

      await useCase.execute({
        conversationId: 'chat-123',
        text: '✅ OK',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('debrief.response.received', {
        conversationId: 'chat-123',
        text: '✅ OK',
      });
    });

    it('should log show-details action with source count', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
      });

      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summaries: [{ source: 'garmin' }, { source: 'github' }, { source: 'strava' }],
        },
      ]);

      await useCase.execute({
        conversationId: 'chat-123',
        text: '📊 Details',
        messageId: 'msg-001',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('debrief.show-details', {
        conversationId: 'chat-123',
        sources: 3,
      });
    });

    it('should log ask-me action with category and question', async () => {
      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: {
          date: '2024-01-15',
          categories: [{ key: 'fitness', icon: '🏃' }],
          questions: {
            fitness: ['What was your workout like?'],
          },
        },
      });

      await useCase.execute({
        conversationId: 'chat-123',
        text: '💬 Ask',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('debrief.ask-me.started', {
        conversationId: 'chat-123',
        category: 'fitness',
        question: 'What was your workout like?',
      });
    });
  });

  describe('execute - without optional journalEntryRepository', () => {
    it('should work without journalEntryRepository for show details', async () => {
      const useCaseNoRepo = new HandleDebriefResponse({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockConversationStateStore,
        debriefRepository: mockDebriefRepository,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });

      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
      });

      mockDebriefRepository.getRecentDebriefs.mockResolvedValue([
        {
          date: '2024-01-15',
          summaries: [{ source: 'garmin' }],
        },
      ]);

      const result = await useCaseNoRepo.execute({
        conversationId: 'chat-123',
        text: '📊 Details',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('show_details');
    });

    it('should work without journalEntryRepository for ask me', async () => {
      const useCaseNoRepo = new HandleDebriefResponse({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockConversationStateStore,
        debriefRepository: mockDebriefRepository,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });

      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: {
          date: '2024-01-15',
          categories: [{ key: 'fitness', icon: '🏃' }],
          questions: { fitness: ['Test question?'] },
        },
      });

      const result = await useCaseNoRepo.execute({
        conversationId: 'chat-123',
        text: '💬 Ask',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('ask_me');
    });

    it('should work without journalEntryRepository for accept', async () => {
      const useCaseNoRepo = new HandleDebriefResponse({
        messagingGateway: mockMessagingGateway,
        conversationStateStore: mockConversationStateStore,
        debriefRepository: mockDebriefRepository,
        userResolver: mockUserResolver,
        logger: mockLogger,
      });

      mockConversationStateStore.get.mockResolvedValue({
        activeFlow: 'morning_debrief',
        debrief: { date: '2024-01-15' },
        messageId: 'msg-001',
      });

      const result = await useCaseNoRepo.execute({
        conversationId: 'chat-123',
        text: '✅ OK',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('accept');
    });
  });
});
