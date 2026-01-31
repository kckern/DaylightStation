// tests/unit/applications/journalist/JournalistContainer.test.mjs
import { describe, it, expect, beforeEach } from '@jest/globals';
import { jest } from '@jest/globals';
import { JournalistContainer } from '#backend/src/3_applications/journalist/JournalistContainer.mjs';

describe('JournalistContainer', () => {
  let mockMessagingGateway;
  let mockAIGateway;
  let mockConversationStateStore;
  let mockJournalEntryRepository;
  let mockMessageQueueRepository;
  let mockQuizRepository;
  let mockUserResolver;
  let mockLogger;

  beforeEach(() => {
    mockMessagingGateway = {
      sendMessage: jest.fn(),
      sendPhoto: jest.fn(),
      editMessage: jest.fn(),
      deleteMessage: jest.fn(),
    };
    mockAIGateway = {
      chat: jest.fn(),
      complete: jest.fn(),
      transcribe: jest.fn(),
    };
    mockConversationStateStore = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
    };
    mockJournalEntryRepository = {
      save: jest.fn(),
      findByDate: jest.fn(),
      findRecent: jest.fn(),
    };
    mockMessageQueueRepository = {
      add: jest.fn(),
      peek: jest.fn(),
      remove: jest.fn(),
    };
    mockQuizRepository = {
      getRandomQuestion: jest.fn(),
      recordAnswer: jest.fn(),
    };
    mockUserResolver = {
      resolve: jest.fn(),
    };
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };
  });

  describe('constructor', () => {
    it('should create container with injected dependencies', () => {
      const container = new JournalistContainer(
        { username: 'testuser' },
        {
          messagingGateway: mockMessagingGateway,
          aiGateway: mockAIGateway,
          conversationStateStore: mockConversationStateStore,
          logger: mockLogger,
        }
      );

      expect(container.getMessagingGateway()).toBe(mockMessagingGateway);
    });

    it('should use console as default logger when not provided', () => {
      const container = new JournalistContainer({ username: 'testuser' });
      // Should not throw - logger defaults to console
      expect(container).toBeInstanceOf(JournalistContainer);
    });
  });

  describe('getMessagingGateway', () => {
    it('should throw if messagingGateway not configured', () => {
      const container = new JournalistContainer({});
      expect(() => container.getMessagingGateway()).toThrow('messagingGateway not configured');
    });

    it('should return configured messagingGateway', () => {
      const container = new JournalistContainer(
        {},
        { messagingGateway: mockMessagingGateway }
      );
      expect(container.getMessagingGateway()).toBe(mockMessagingGateway);
    });
  });

  describe('getAIGateway', () => {
    it('should throw if aiGateway not configured', () => {
      const container = new JournalistContainer({});
      expect(() => container.getAIGateway()).toThrow('aiGateway not configured');
    });

    it('should wrap AI gateway with LoggingAIGateway', () => {
      const container = new JournalistContainer(
        { username: 'testuser' },
        {
          aiGateway: mockAIGateway,
          logger: mockLogger,
        }
      );

      const wrapped = container.getAIGateway();
      expect(wrapped).not.toBe(mockAIGateway);
      expect(wrapped.constructor.name).toBe('LoggingAIGateway');
    });

    it('should return same wrapped instance on repeated calls', () => {
      const container = new JournalistContainer(
        { username: 'testuser' },
        {
          aiGateway: mockAIGateway,
          logger: mockLogger,
        }
      );

      const wrapped1 = container.getAIGateway();
      const wrapped2 = container.getAIGateway();
      expect(wrapped1).toBe(wrapped2);
    });
  });

  describe('infrastructure getters', () => {
    let container;

    beforeEach(() => {
      container = new JournalistContainer(
        { username: 'testuser' },
        {
          journalEntryRepository: mockJournalEntryRepository,
          messageQueueRepository: mockMessageQueueRepository,
          conversationStateStore: mockConversationStateStore,
          quizRepository: mockQuizRepository,
          userResolver: mockUserResolver,
          logger: mockLogger,
        }
      );
    });

    it('should return journalEntryRepository', () => {
      expect(container.getJournalEntryRepository()).toBe(mockJournalEntryRepository);
    });

    it('should return messageQueueRepository', () => {
      expect(container.getMessageQueueRepository()).toBe(mockMessageQueueRepository);
    });

    it('should return conversationStateStore', () => {
      expect(container.getConversationStateStore()).toBe(mockConversationStateStore);
    });

    it('should return quizRepository', () => {
      expect(container.getQuizRepository()).toBe(mockQuizRepository);
    });

    it('should return userResolver', () => {
      expect(container.getUserResolver()).toBe(mockUserResolver);
    });
  });

  describe('use case getters', () => {
    let container;

    beforeEach(() => {
      container = new JournalistContainer(
        { username: 'testuser' },
        {
          messagingGateway: mockMessagingGateway,
          aiGateway: mockAIGateway,
          conversationStateStore: mockConversationStateStore,
          journalEntryRepository: mockJournalEntryRepository,
          messageQueueRepository: mockMessageQueueRepository,
          quizRepository: mockQuizRepository,
          userResolver: mockUserResolver,
          logger: mockLogger,
        }
      );
    });

    describe('core use cases', () => {
      it('should lazy-load ProcessTextEntry and return same instance', () => {
        const useCase1 = container.getProcessTextEntry();
        const useCase2 = container.getProcessTextEntry();
        expect(useCase1).toBeDefined();
        expect(useCase1).toBe(useCase2); // Same instance
      });

      it('should lazy-load ProcessVoiceEntry', () => {
        const useCase = container.getProcessVoiceEntry();
        expect(useCase).toBeDefined();
      });

      it('should lazy-load InitiateJournalPrompt', () => {
        const useCase = container.getInitiateJournalPrompt();
        expect(useCase).toBeDefined();
      });

      it('should lazy-load GenerateMultipleChoices', () => {
        const useCase = container.getGenerateMultipleChoices();
        expect(useCase).toBeDefined();
      });

      it('should lazy-load HandleCallbackResponse', () => {
        const useCase = container.getHandleCallbackResponse();
        expect(useCase).toBeDefined();
      });
    });

    describe('quiz use cases', () => {
      it('should lazy-load SendQuizQuestion', () => {
        expect(container.getSendQuizQuestion()).toBeDefined();
      });

      it('should lazy-load RecordQuizAnswer', () => {
        expect(container.getRecordQuizAnswer()).toBeDefined();
      });

      it('should lazy-load AdvanceToNextQuizQuestion', () => {
        expect(container.getAdvanceToNextQuizQuestion()).toBeDefined();
      });

      it('should lazy-load HandleQuizAnswer', () => {
        expect(container.getHandleQuizAnswer()).toBeDefined();
      });
    });

    describe('analysis use cases', () => {
      it('should lazy-load GenerateTherapistAnalysis', () => {
        expect(container.getGenerateTherapistAnalysis()).toBeDefined();
      });

      it('should lazy-load ReviewJournalEntries', () => {
        expect(container.getReviewJournalEntries()).toBeDefined();
      });

      it('should lazy-load ExportJournalMarkdown', () => {
        expect(container.getExportJournalMarkdown()).toBeDefined();
      });
    });

    describe('command use cases', () => {
      it('should lazy-load HandleSlashCommand', () => {
        expect(container.getHandleSlashCommand()).toBeDefined();
      });

      it('should lazy-load HandleSpecialStart', () => {
        expect(container.getHandleSpecialStart()).toBeDefined();
      });
    });

    describe('morning debrief use cases', () => {
      it('should lazy-load GenerateMorningDebrief', () => {
        expect(container.getGenerateMorningDebrief()).toBeDefined();
      });

      it('should lazy-load SendMorningDebrief', () => {
        expect(container.getSendMorningDebrief()).toBeDefined();
      });

      it('should lazy-load HandleDebriefResponse', () => {
        expect(container.getHandleDebriefResponse()).toBeDefined();
      });

      it('should lazy-load HandleSourceSelection', () => {
        expect(container.getHandleSourceSelection()).toBeDefined();
      });

      it('should lazy-load HandleCategorySelection', () => {
        expect(container.getHandleCategorySelection()).toBeDefined();
      });

      it('should lazy-load InitiateDebriefInterview', () => {
        expect(container.getInitiateDebriefInterview()).toBeDefined();
      });
    });

    describe('adapters and repositories', () => {
      it('should lazy-load LifelogAggregator', () => {
        expect(container.getLifelogAggregator()).toBeDefined();
      });

      it('should lazy-load DebriefRepository', () => {
        expect(container.getDebriefRepository()).toBeDefined();
      });

      it('should return same DebriefRepository instance on repeated calls', () => {
        const repo1 = container.getDebriefRepository();
        const repo2 = container.getDebriefRepository();
        expect(repo1).toBe(repo2);
      });
    });
  });

  describe('lifecycle', () => {
    it('should initialize without error', async () => {
      const container = new JournalistContainer({}, { logger: mockLogger });
      await expect(container.initialize()).resolves.toBeUndefined();
    });

    it('should log on initialize', async () => {
      const container = new JournalistContainer({}, { logger: mockLogger });
      await container.initialize();
      expect(mockLogger.info).toHaveBeenCalledWith('container.initialize', { app: 'journalist' });
    });

    it('should shutdown without error', async () => {
      const container = new JournalistContainer({}, { logger: mockLogger });
      await expect(container.shutdown()).resolves.toBeUndefined();
    });

    it('should log on shutdown', async () => {
      const container = new JournalistContainer({}, { logger: mockLogger });
      await container.shutdown();
      expect(mockLogger.info).toHaveBeenCalledWith('container.shutdown', { app: 'journalist' });
    });
  });
});
