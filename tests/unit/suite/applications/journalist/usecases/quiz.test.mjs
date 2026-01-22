// tests/unit/applications/journalist/usecases/quiz.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('Quiz Use Cases', () => {
  // Shared mocks
  let mockMessagingGateway;
  let mockQuizRepository;
  let mockMessageQueueRepository;
  let mockLogger;

  // Mock question data
  const createMockQuestion = (overrides = {}) => ({
    uuid: 'question-uuid-1',
    category: 'daily',
    question: 'How are you feeling today?',
    choices: ['Great', 'Good', 'Okay', 'Not great'],
    lastAsked: null,
    hasBeenAsked: false,
    markAsked: jest.fn().mockReturnValue({
      uuid: 'question-uuid-1',
      category: 'daily',
      question: 'How are you feeling today?',
      choices: ['Great', 'Good', 'Okay', 'Not great'],
      lastAsked: new Date().toISOString(),
      hasBeenAsked: true,
    }),
    ...overrides,
  });

  beforeEach(() => {
    mockMessagingGateway = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: 'sent-msg-123' }),
      updateMessage: jest.fn().mockResolvedValue(undefined),
      deleteMessage: jest.fn().mockResolvedValue(undefined),
    };

    mockQuizRepository = {
      loadQuestions: jest.fn().mockResolvedValue([]),
      recordAnswer: jest.fn().mockResolvedValue(undefined),
    };

    mockMessageQueueRepository = {
      saveToQueue: jest.fn().mockResolvedValue(undefined),
      loadUnsentQueue: jest.fn().mockResolvedValue([]),
      markSent: jest.fn().mockResolvedValue(undefined),
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  describe('SendQuizQuestion', () => {
    let SendQuizQuestion;
    let useCase;

    beforeEach(async () => {
      const module = await import('@backend/src/3_applications/journalist/usecases/SendQuizQuestion.mjs');
      SendQuizQuestion = module.SendQuizQuestion;
    });

    describe('constructor', () => {
      it('should throw if messagingGateway is not provided', () => {
        expect(() => new SendQuizQuestion({ quizRepository: mockQuizRepository })).toThrow(
          'messagingGateway is required'
        );
      });

      it('should throw if quizRepository is not provided', () => {
        expect(() => new SendQuizQuestion({ messagingGateway: mockMessagingGateway })).toThrow(
          'quizRepository is required'
        );
      });

      it('should create instance with required dependencies', () => {
        const instance = new SendQuizQuestion({
          messagingGateway: mockMessagingGateway,
          quizRepository: mockQuizRepository,
        });
        expect(instance).toBeInstanceOf(SendQuizQuestion);
      });

      it('should create instance with all dependencies', () => {
        const instance = new SendQuizQuestion({
          messagingGateway: mockMessagingGateway,
          quizRepository: mockQuizRepository,
          messageQueueRepository: mockMessageQueueRepository,
          logger: mockLogger,
        });
        expect(instance).toBeInstanceOf(SendQuizQuestion);
      });
    });

    describe('execute', () => {
      beforeEach(() => {
        useCase = new SendQuizQuestion({
          messagingGateway: mockMessagingGateway,
          quizRepository: mockQuizRepository,
          messageQueueRepository: mockMessageQueueRepository,
          logger: mockLogger,
        });
      });

      it('should send quiz question with options', async () => {
        const mockQuestion = createMockQuestion();
        mockQuizRepository.loadQuestions.mockResolvedValue([mockQuestion]);

        const result = await useCase.execute({
          chatId: 'chat-123',
          category: 'daily',
        });

        expect(result.success).toBe(true);
        expect(result.messageId).toBe('sent-msg-123');
        expect(result.questionUuid).toBe('question-uuid-1');
        expect(result.question).toBe('How are you feeling today?');

        expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
          'chat-123',
          expect.stringContaining('How are you feeling today?'),
          expect.objectContaining({
            choices: expect.any(Array),
            inline: true,
            foreignKey: { quiz: 'question-uuid-1' },
          })
        );
      });

      it('should return failure when no questions available', async () => {
        mockQuizRepository.loadQuestions.mockResolvedValue([]);

        const result = await useCase.execute({
          chatId: 'chat-123',
          category: 'daily',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('No questions available');
        expect(mockMessagingGateway.sendMessage).not.toHaveBeenCalled();
      });

      it('should build keyboard with each choice as separate row', async () => {
        const mockQuestion = createMockQuestion({
          choices: ['Option A', 'Option B', 'Option C'],
        });
        mockQuizRepository.loadQuestions.mockResolvedValue([mockQuestion]);

        await useCase.execute({
          chatId: 'chat-123',
        });

        const sentOptions = mockMessagingGateway.sendMessage.mock.calls[0][2];
        expect(sentOptions.choices).toEqual([
          ['Option A'],
          ['Option B'],
          ['Option C'],
        ]);
      });

      it('should prefer unasked questions', async () => {
        const askedQuestion = createMockQuestion({
          uuid: 'asked-q',
          lastAsked: '2025-01-01',
          hasBeenAsked: true,
        });
        const unaskedQuestion = createMockQuestion({
          uuid: 'unasked-q',
          lastAsked: null,
          hasBeenAsked: false,
        });
        mockQuizRepository.loadQuestions.mockResolvedValue([askedQuestion, unaskedQuestion]);

        await useCase.execute({
          chatId: 'chat-123',
        });

        expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
          'chat-123',
          expect.any(String),
          expect.objectContaining({
            foreignKey: { quiz: 'unasked-q' },
          })
        );
      });

      it('should select oldest asked question when all have been asked', async () => {
        const olderQuestion = createMockQuestion({
          uuid: 'older-q',
          lastAsked: '2024-01-01',
          hasBeenAsked: true,
        });
        const newerQuestion = createMockQuestion({
          uuid: 'newer-q',
          lastAsked: '2025-01-01',
          hasBeenAsked: true,
        });
        mockQuizRepository.loadQuestions.mockResolvedValue([newerQuestion, olderQuestion]);

        await useCase.execute({
          chatId: 'chat-123',
        });

        expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
          'chat-123',
          expect.any(String),
          expect.objectContaining({
            foreignKey: { quiz: 'older-q' },
          })
        );
      });

      it('should mark question as asked after sending', async () => {
        const mockQuestion = createMockQuestion();
        mockQuizRepository.loadQuestions.mockResolvedValue([mockQuestion]);

        await useCase.execute({
          chatId: 'chat-123',
        });

        expect(mockQuestion.markAsked).toHaveBeenCalled();
        expect(mockQuizRepository.recordAnswer).toHaveBeenCalledWith('question-uuid-1', null);
      });

      it('should queue remaining questions when messageQueueRepository is provided', async () => {
        const questions = [
          createMockQuestion({ uuid: 'q1', question: 'Question 1' }),
          createMockQuestion({ uuid: 'q2', question: 'Question 2' }),
          createMockQuestion({ uuid: 'q3', question: 'Question 3' }),
        ];
        mockQuizRepository.loadQuestions.mockResolvedValue(questions);

        await useCase.execute({
          chatId: 'chat-123',
        });

        expect(mockMessageQueueRepository.saveToQueue).toHaveBeenCalledWith(
          'chat-123',
          expect.arrayContaining([
            expect.objectContaining({ queuedMessage: 'Question 2' }),
            expect.objectContaining({ queuedMessage: 'Question 3' }),
          ])
        );
      });

      it('should log debug on start and info on completion', async () => {
        const mockQuestion = createMockQuestion();
        mockQuizRepository.loadQuestions.mockResolvedValue([mockQuestion]);

        await useCase.execute({
          chatId: 'chat-123',
          category: 'daily',
        });

        expect(mockLogger.debug).toHaveBeenCalledWith('quiz.send.start', {
          chatId: 'chat-123',
          category: 'daily',
        });
        expect(mockLogger.info).toHaveBeenCalledWith('quiz.send.complete', expect.any(Object));
      });

      it('should log warning when no questions available', async () => {
        mockQuizRepository.loadQuestions.mockResolvedValue([]);

        await useCase.execute({
          chatId: 'chat-123',
          category: 'daily',
        });

        expect(mockLogger.warn).toHaveBeenCalledWith('quiz.send.noQuestions', {
          chatId: 'chat-123',
          category: 'daily',
        });
      });

      it('should throw and log error when messaging gateway fails', async () => {
        const mockQuestion = createMockQuestion();
        mockQuizRepository.loadQuestions.mockResolvedValue([mockQuestion]);
        mockMessagingGateway.sendMessage.mockRejectedValue(new Error('Network error'));

        await expect(
          useCase.execute({ chatId: 'chat-123' })
        ).rejects.toThrow('Network error');

        expect(mockLogger.error).toHaveBeenCalledWith('quiz.send.error', {
          chatId: 'chat-123',
          error: 'Network error',
        });
      });
    });
  });

  describe('RecordQuizAnswer', () => {
    let RecordQuizAnswer;
    let useCase;

    beforeEach(async () => {
      const module = await import('@backend/src/3_applications/journalist/usecases/RecordQuizAnswer.mjs');
      RecordQuizAnswer = module.RecordQuizAnswer;
    });

    describe('constructor', () => {
      it('should create instance without quizRepository (temporary during development)', () => {
        const instance = new RecordQuizAnswer({
          logger: mockLogger,
        });
        expect(instance).toBeInstanceOf(RecordQuizAnswer);
      });

      it('should create instance with all dependencies', () => {
        const instance = new RecordQuizAnswer({
          quizRepository: mockQuizRepository,
          messageQueueRepository: mockMessageQueueRepository,
          logger: mockLogger,
        });
        expect(instance).toBeInstanceOf(RecordQuizAnswer);
      });
    });

    describe('execute', () => {
      it('should return failure when quizRepository is not available', async () => {
        useCase = new RecordQuizAnswer({
          logger: mockLogger,
        });

        const result = await useCase.execute({
          chatId: 'chat-123',
          questionUuid: 'question-uuid-1',
          answer: 'Great',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Quiz repository not implemented yet');
        expect(mockLogger.warn).toHaveBeenCalledWith('quiz.recordAnswer.repository-not-available', {
          chatId: 'chat-123',
          questionUuid: 'question-uuid-1',
        });
      });

      it('should record answer to repository', async () => {
        useCase = new RecordQuizAnswer({
          quizRepository: mockQuizRepository,
          logger: mockLogger,
        });

        const result = await useCase.execute({
          chatId: 'chat-123',
          questionUuid: 'question-uuid-1',
          answer: 'Great',
        });

        expect(result.success).toBe(true);
        expect(result.answerUuid).toBeDefined();

        expect(mockQuizRepository.recordAnswer).toHaveBeenCalledWith(
          'question-uuid-1',
          expect.objectContaining({
            questionUuid: 'question-uuid-1',
            chatId: 'chat-123',
            answer: 'Great',
          })
        );
      });

      it('should record numeric answer (choice index)', async () => {
        useCase = new RecordQuizAnswer({
          quizRepository: mockQuizRepository,
          logger: mockLogger,
        });

        await useCase.execute({
          chatId: 'chat-123',
          questionUuid: 'question-uuid-1',
          answer: 2,
        });

        expect(mockQuizRepository.recordAnswer).toHaveBeenCalledWith(
          'question-uuid-1',
          expect.objectContaining({
            answer: 2,
          })
        );
      });

      it('should use provided date or default to today', async () => {
        useCase = new RecordQuizAnswer({
          quizRepository: mockQuizRepository,
          logger: mockLogger,
        });

        await useCase.execute({
          chatId: 'chat-123',
          questionUuid: 'question-uuid-1',
          answer: 'Great',
          date: '2025-06-15',
        });

        expect(mockQuizRepository.recordAnswer).toHaveBeenCalledWith(
          'question-uuid-1',
          expect.objectContaining({
            date: '2025-06-15',
          })
        );
      });

      it('should log debug on start and info on completion', async () => {
        useCase = new RecordQuizAnswer({
          quizRepository: mockQuizRepository,
          logger: mockLogger,
        });

        await useCase.execute({
          chatId: 'chat-123',
          questionUuid: 'question-uuid-1',
          answer: 'Great',
        });

        expect(mockLogger.debug).toHaveBeenCalledWith('quiz.recordAnswer.start', {
          chatId: 'chat-123',
          questionUuid: 'question-uuid-1',
        });
        expect(mockLogger.info).toHaveBeenCalledWith('quiz.recordAnswer.complete', expect.any(Object));
      });

      it('should throw and log error when repository fails', async () => {
        useCase = new RecordQuizAnswer({
          quizRepository: mockQuizRepository,
          logger: mockLogger,
        });
        mockQuizRepository.recordAnswer.mockRejectedValue(new Error('Database error'));

        await expect(
          useCase.execute({
            chatId: 'chat-123',
            questionUuid: 'question-uuid-1',
            answer: 'Great',
          })
        ).rejects.toThrow('Database error');

        expect(mockLogger.error).toHaveBeenCalledWith('quiz.recordAnswer.error', {
          chatId: 'chat-123',
          error: 'Database error',
        });
      });
    });
  });

  describe('HandleQuizAnswer', () => {
    let HandleQuizAnswer;
    let useCase;
    let mockRecordQuizAnswer;
    let mockAdvanceToNextQuizQuestion;

    beforeEach(async () => {
      const module = await import('@backend/src/3_applications/journalist/usecases/HandleQuizAnswer.mjs');
      HandleQuizAnswer = module.HandleQuizAnswer;

      mockRecordQuizAnswer = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          answerUuid: 'answer-uuid-123',
        }),
      };

      mockAdvanceToNextQuizQuestion = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          action: 'next_question',
          questionUuid: 'next-question-uuid',
        }),
      };
    });

    describe('constructor', () => {
      it('should throw if recordQuizAnswer is not provided', () => {
        expect(() => new HandleQuizAnswer({
          advanceToNextQuizQuestion: mockAdvanceToNextQuizQuestion,
        })).toThrow('recordQuizAnswer is required');
      });

      it('should throw if advanceToNextQuizQuestion is not provided', () => {
        expect(() => new HandleQuizAnswer({
          recordQuizAnswer: mockRecordQuizAnswer,
        })).toThrow('advanceToNextQuizQuestion is required');
      });

      it('should create instance with required dependencies', () => {
        const instance = new HandleQuizAnswer({
          recordQuizAnswer: mockRecordQuizAnswer,
          advanceToNextQuizQuestion: mockAdvanceToNextQuizQuestion,
        });
        expect(instance).toBeInstanceOf(HandleQuizAnswer);
      });

      it('should create instance with all dependencies', () => {
        const instance = new HandleQuizAnswer({
          recordQuizAnswer: mockRecordQuizAnswer,
          advanceToNextQuizQuestion: mockAdvanceToNextQuizQuestion,
          messageQueueRepository: mockMessageQueueRepository,
          logger: mockLogger,
        });
        expect(instance).toBeInstanceOf(HandleQuizAnswer);
      });
    });

    describe('execute', () => {
      beforeEach(() => {
        useCase = new HandleQuizAnswer({
          recordQuizAnswer: mockRecordQuizAnswer,
          advanceToNextQuizQuestion: mockAdvanceToNextQuizQuestion,
          messageQueueRepository: mockMessageQueueRepository,
          logger: mockLogger,
        });
      });

      it('should record answer and advance to next question', async () => {
        const result = await useCase.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
          questionUuid: 'question-uuid-1',
          answer: 'Great',
        });

        expect(result.success).toBe(true);
        expect(result.answerUuid).toBe('answer-uuid-123');
        expect(result.nextAction).toBe('next_question');

        expect(mockRecordQuizAnswer.execute).toHaveBeenCalledWith({
          chatId: 'chat-123',
          questionUuid: 'question-uuid-1',
          answer: 'Great',
        });

        expect(mockAdvanceToNextQuizQuestion.execute).toHaveBeenCalledWith({
          chatId: 'chat-123',
          messageId: 'msg-456',
        });
      });

      it('should mark queue item as sent when queueUuid is provided', async () => {
        await useCase.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
          questionUuid: 'question-uuid-1',
          answer: 'Great',
          queueUuid: 'queue-item-uuid',
        });

        expect(mockMessageQueueRepository.markSent).toHaveBeenCalledWith(
          'queue-item-uuid',
          'msg-456'
        );
      });

      it('should not call markSent when queueUuid is not provided', async () => {
        await useCase.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
          questionUuid: 'question-uuid-1',
          answer: 'Great',
        });

        expect(mockMessageQueueRepository.markSent).not.toHaveBeenCalled();
      });

      it('should return advance result details', async () => {
        mockAdvanceToNextQuizQuestion.execute.mockResolvedValue({
          success: true,
          action: 'transition_to_journal',
          journalResult: { started: true },
        });

        const result = await useCase.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
          questionUuid: 'question-uuid-1',
          answer: 'Great',
        });

        expect(result.nextAction).toBe('transition_to_journal');
        expect(result.advanceResult).toEqual({
          success: true,
          action: 'transition_to_journal',
          journalResult: { started: true },
        });
      });

      it('should log debug on start and info on completion', async () => {
        await useCase.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
          questionUuid: 'question-uuid-1',
          answer: 'Great',
        });

        expect(mockLogger.debug).toHaveBeenCalledWith('quiz.handleAnswer.start', {
          chatId: 'chat-123',
          questionUuid: 'question-uuid-1',
        });
        expect(mockLogger.info).toHaveBeenCalledWith('quiz.handleAnswer.complete', expect.any(Object));
      });

      it('should throw and log error when recordQuizAnswer fails', async () => {
        mockRecordQuizAnswer.execute.mockRejectedValue(new Error('Record failed'));

        await expect(
          useCase.execute({
            chatId: 'chat-123',
            messageId: 'msg-456',
            questionUuid: 'question-uuid-1',
            answer: 'Great',
          })
        ).rejects.toThrow('Record failed');

        expect(mockLogger.error).toHaveBeenCalledWith('quiz.handleAnswer.error', {
          chatId: 'chat-123',
          error: 'Record failed',
        });
      });

      it('should throw and log error when advanceToNextQuizQuestion fails', async () => {
        mockAdvanceToNextQuizQuestion.execute.mockRejectedValue(new Error('Advance failed'));

        await expect(
          useCase.execute({
            chatId: 'chat-123',
            messageId: 'msg-456',
            questionUuid: 'question-uuid-1',
            answer: 'Great',
          })
        ).rejects.toThrow('Advance failed');

        expect(mockLogger.error).toHaveBeenCalledWith('quiz.handleAnswer.error', {
          chatId: 'chat-123',
          error: 'Advance failed',
        });
      });
    });

    describe('execute - without optional messageQueueRepository', () => {
      it('should work without messageQueueRepository', async () => {
        const useCaseNoQueue = new HandleQuizAnswer({
          recordQuizAnswer: mockRecordQuizAnswer,
          advanceToNextQuizQuestion: mockAdvanceToNextQuizQuestion,
          logger: mockLogger,
        });

        const result = await useCaseNoQueue.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
          questionUuid: 'question-uuid-1',
          answer: 'Great',
          queueUuid: 'queue-item-uuid', // Should be ignored
        });

        expect(result.success).toBe(true);
      });
    });
  });

  describe('AdvanceToNextQuizQuestion', () => {
    let AdvanceToNextQuizQuestion;
    let useCase;
    let mockInitiateJournalPrompt;

    beforeEach(async () => {
      const module = await import('@backend/src/3_applications/journalist/usecases/AdvanceToNextQuizQuestion.mjs');
      AdvanceToNextQuizQuestion = module.AdvanceToNextQuizQuestion;

      mockInitiateJournalPrompt = {
        execute: jest.fn().mockResolvedValue({ success: true }),
      };
    });

    describe('constructor', () => {
      it('should throw if messagingGateway is not provided', () => {
        expect(() => new AdvanceToNextQuizQuestion({})).toThrow('messagingGateway is required');
      });

      it('should create instance with required dependencies', () => {
        const instance = new AdvanceToNextQuizQuestion({
          messagingGateway: mockMessagingGateway,
        });
        expect(instance).toBeInstanceOf(AdvanceToNextQuizQuestion);
      });

      it('should create instance with all dependencies', () => {
        const instance = new AdvanceToNextQuizQuestion({
          messagingGateway: mockMessagingGateway,
          messageQueueRepository: mockMessageQueueRepository,
          initiateJournalPrompt: mockInitiateJournalPrompt,
          logger: mockLogger,
        });
        expect(instance).toBeInstanceOf(AdvanceToNextQuizQuestion);
      });
    });

    describe('execute', () => {
      beforeEach(() => {
        useCase = new AdvanceToNextQuizQuestion({
          messagingGateway: mockMessagingGateway,
          messageQueueRepository: mockMessageQueueRepository,
          initiateJournalPrompt: mockInitiateJournalPrompt,
          logger: mockLogger,
        });
      });

      it('should advance to next question when queue has more quiz items', async () => {
        mockMessageQueueRepository.loadUnsentQueue.mockResolvedValue([
          {
            uuid: 'queue-item-uuid',
            queuedMessage: 'Next question text?',
            foreignKey: { quiz: 'next-question-uuid' },
            isSent: () => false,
          },
        ]);

        const result = await useCase.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
        });

        expect(result.success).toBe(true);
        expect(result.action).toBe('next_question');
        expect(result.questionUuid).toBe('next-question-uuid');

        expect(mockMessagingGateway.updateMessage).toHaveBeenCalledWith(
          'chat-123',
          'msg-456',
          expect.objectContaining({
            text: expect.stringContaining('Next question text?'),
          })
        );
      });

      it('should mark queue item as sent after updating message', async () => {
        mockMessageQueueRepository.loadUnsentQueue.mockResolvedValue([
          {
            uuid: 'queue-item-uuid',
            queuedMessage: 'Next question?',
            foreignKey: { quiz: 'next-q-uuid' },
            isSent: () => false,
          },
        ]);

        await useCase.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
        });

        expect(mockMessageQueueRepository.markSent).toHaveBeenCalledWith(
          'queue-item-uuid',
          'msg-456'
        );
      });

      it('should transition to journal when no more quiz questions', async () => {
        mockMessageQueueRepository.loadUnsentQueue.mockResolvedValue([]);

        const result = await useCase.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
        });

        expect(result.success).toBe(true);
        expect(result.action).toBe('transition_to_journal');

        expect(mockMessagingGateway.deleteMessage).toHaveBeenCalledWith('chat-123', 'msg-456');
        expect(mockInitiateJournalPrompt.execute).toHaveBeenCalledWith({ chatId: 'chat-123' });
      });

      it('should return quiz_complete when no initiateJournalPrompt is available', async () => {
        const useCaseNoJournal = new AdvanceToNextQuizQuestion({
          messagingGateway: mockMessagingGateway,
          messageQueueRepository: mockMessageQueueRepository,
          logger: mockLogger,
        });

        mockMessageQueueRepository.loadUnsentQueue.mockResolvedValue([]);

        const result = await useCaseNoJournal.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
        });

        expect(result.success).toBe(true);
        expect(result.action).toBe('quiz_complete');
      });

      it('should skip queue items that are already sent', async () => {
        mockMessageQueueRepository.loadUnsentQueue.mockResolvedValue([
          {
            uuid: 'sent-item',
            queuedMessage: 'Already sent',
            foreignKey: { quiz: 'sent-q' },
            isSent: () => true, // Already sent
          },
          {
            uuid: 'unsent-item',
            queuedMessage: 'Next question',
            foreignKey: { quiz: 'unsent-q' },
            isSent: () => false,
          },
        ]);

        const result = await useCase.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
        });

        expect(result.questionUuid).toBe('unsent-q');
      });

      it('should skip queue items without quiz foreignKey', async () => {
        mockMessageQueueRepository.loadUnsentQueue.mockResolvedValue([
          {
            uuid: 'non-quiz-item',
            queuedMessage: 'Not a quiz',
            foreignKey: { journal: 'some-journal' },
            isSent: () => false,
          },
        ]);

        const result = await useCase.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
        });

        expect(result.action).toBe('transition_to_journal');
      });

      it('should ignore delete message errors', async () => {
        mockMessageQueueRepository.loadUnsentQueue.mockResolvedValue([]);
        mockMessagingGateway.deleteMessage.mockRejectedValue(new Error('Message not found'));

        const result = await useCase.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
        });

        expect(result.success).toBe(true);
        expect(result.action).toBe('transition_to_journal');
      });

      it('should log debug on start and info on completion', async () => {
        mockMessageQueueRepository.loadUnsentQueue.mockResolvedValue([]);

        await useCase.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
        });

        expect(mockLogger.debug).toHaveBeenCalledWith('quiz.advance.start', {
          chatId: 'chat-123',
          messageId: 'msg-456',
        });
        expect(mockLogger.info).toHaveBeenCalled();
      });

      it('should throw and log error when updateMessage fails', async () => {
        mockMessageQueueRepository.loadUnsentQueue.mockResolvedValue([
          {
            uuid: 'queue-item',
            queuedMessage: 'Next question',
            foreignKey: { quiz: 'next-q' },
            isSent: () => false,
          },
        ]);
        mockMessagingGateway.updateMessage.mockRejectedValue(new Error('Update failed'));

        await expect(
          useCase.execute({
            chatId: 'chat-123',
            messageId: 'msg-456',
          })
        ).rejects.toThrow('Update failed');

        expect(mockLogger.error).toHaveBeenCalledWith('quiz.advance.error', {
          chatId: 'chat-123',
          error: 'Update failed',
        });
      });
    });

    describe('execute - without optional messageQueueRepository', () => {
      it('should transition to journal when no messageQueueRepository', async () => {
        const useCaseNoQueue = new AdvanceToNextQuizQuestion({
          messagingGateway: mockMessagingGateway,
          initiateJournalPrompt: mockInitiateJournalPrompt,
          logger: mockLogger,
        });

        const result = await useCaseNoQueue.execute({
          chatId: 'chat-123',
          messageId: 'msg-456',
        });

        expect(result.success).toBe(true);
        expect(result.action).toBe('transition_to_journal');
      });
    });
  });
});
