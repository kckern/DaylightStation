/**
 * Journalist Use Cases Tests - Quiz Flow
 * @group journalist
 * @group Phase5
 */

import { jest } from '@jest/globals';
import { SendQuizQuestion } from '../../journalist/application/usecases/SendQuizQuestion.mjs';
import { RecordQuizAnswer } from '../../journalist/application/usecases/RecordQuizAnswer.mjs';
import { AdvanceToNextQuizQuestion } from '../../journalist/application/usecases/AdvanceToNextQuizQuestion.mjs';
import { HandleQuizAnswer } from '../../journalist/application/usecases/HandleQuizAnswer.mjs';
import { QuizQuestion } from '../../journalist/domain/entities/QuizQuestion.mjs';

// Mock dependencies
const createMockMessagingGateway = () => ({
  sendMessage: jest.fn().mockResolvedValue({ messageId: 'msg-123' }),
  updateMessage: jest.fn().mockResolvedValue(undefined),
  deleteMessage: jest.fn().mockResolvedValue(undefined),
});

const createMockQuizRepository = () => ({
  loadQuestions: jest.fn().mockResolvedValue([
    QuizQuestion.create({
      category: 'mood',
      question: 'How are you feeling today?',
      choices: ['Great', 'Good', 'Okay', 'Not great'],
    }),
    QuizQuestion.create({
      category: 'mood',
      question: 'What contributed to that feeling?',
      choices: ['Work', 'Family', 'Health', 'Other'],
    }),
  ]),
  recordAnswer: jest.fn().mockResolvedValue(undefined),
});

const createMockQueueRepository = () => ({
  loadUnsentQueue: jest.fn().mockResolvedValue([]),
  saveToQueue: jest.fn().mockResolvedValue(undefined),
  markSent: jest.fn().mockResolvedValue(undefined),
  deleteUnprocessed: jest.fn().mockResolvedValue(undefined),
});

describe('Journalist Quiz Use Cases', () => {
  describe('SendQuizQuestion', () => {
    let useCase;
    let mockMessagingGateway;
    let mockQuizRepository;
    let mockQueueRepository;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();
      mockQuizRepository = createMockQuizRepository();
      mockQueueRepository = createMockQueueRepository();

      useCase = new SendQuizQuestion({
        messagingGateway: mockMessagingGateway,
        quizRepository: mockQuizRepository,
        messageQueueRepository: mockQueueRepository,
      });
    });

    it('should require dependencies', () => {
      expect(() => new SendQuizQuestion({})).toThrow('messagingGateway');
    });

    it('should send quiz question', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        category: 'mood',
      });

      expect(result.success).toBe(true);
      expect(result.questionUuid).toBeDefined();
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-1',
        expect.stringContaining('📋'),
        expect.objectContaining({
          choices: expect.any(Array),
          inline: true,
        })
      );
    });

    it('should queue remaining questions', async () => {
      await useCase.execute({
        chatId: 'chat-1',
        category: 'mood',
      });

      expect(mockQueueRepository.saveToQueue).toHaveBeenCalled();
    });

    it('should handle no questions available', async () => {
      mockQuizRepository.loadQuestions.mockResolvedValue([]);

      const result = await useCase.execute({
        chatId: 'chat-1',
        category: 'unknown',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No questions');
    });
  });

  describe('RecordQuizAnswer', () => {
    let useCase;
    let mockQuizRepository;

    beforeEach(() => {
      mockQuizRepository = createMockQuizRepository();

      useCase = new RecordQuizAnswer({
        quizRepository: mockQuizRepository,
      });
    });

    it('should record answer', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        questionUuid: 'q-123',
        answer: 2,
      });

      expect(result.success).toBe(true);
      expect(result.answerUuid).toBeDefined();
      expect(mockQuizRepository.recordAnswer).toHaveBeenCalled();
    });

    it('should record text answer', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        questionUuid: 'q-123',
        answer: 'Custom response',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('AdvanceToNextQuizQuestion', () => {
    let useCase;
    let mockMessagingGateway;
    let mockQueueRepository;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();
      mockQueueRepository = createMockQueueRepository();

      useCase = new AdvanceToNextQuizQuestion({
        messagingGateway: mockMessagingGateway,
        messageQueueRepository: mockQueueRepository,
      });
    });

    it('should advance to next question when available', async () => {
      mockQueueRepository.loadUnsentQueue.mockResolvedValue([
        {
          uuid: 'queue-1',
          queuedMessage: 'Next question?',
          foreignKey: { quiz: 'q-456' },
          isSent: () => false,
        },
      ]);

      const result = await useCase.execute({
        chatId: 'chat-1',
        messageId: 'msg-1',
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('next_question');
      expect(mockMessagingGateway.updateMessage).toHaveBeenCalled();
    });

    it('should complete quiz when no more questions', async () => {
      mockQueueRepository.loadUnsentQueue.mockResolvedValue([]);

      const result = await useCase.execute({
        chatId: 'chat-1',
        messageId: 'msg-1',
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('quiz_complete');
    });

    it('should transition to journal when available', async () => {
      const mockInitiatePrompt = {
        execute: jest.fn().mockResolvedValue({ success: true }),
      };

      const useCaseWithPrompt = new AdvanceToNextQuizQuestion({
        messagingGateway: mockMessagingGateway,
        messageQueueRepository: mockQueueRepository,
        initiateJournalPrompt: mockInitiatePrompt,
      });

      mockQueueRepository.loadUnsentQueue.mockResolvedValue([]);

      const result = await useCaseWithPrompt.execute({
        chatId: 'chat-1',
        messageId: 'msg-1',
      });

      expect(result.action).toBe('transition_to_journal');
      expect(mockInitiatePrompt.execute).toHaveBeenCalled();
    });
  });

  describe('HandleQuizAnswer', () => {
    let useCase;
    let mockRecordAnswer;
    let mockAdvance;

    beforeEach(() => {
      mockRecordAnswer = {
        execute: jest.fn().mockResolvedValue({ success: true, answerUuid: 'ans-1' }),
      };
      mockAdvance = {
        execute: jest.fn().mockResolvedValue({ success: true, action: 'next_question' }),
      };

      useCase = new HandleQuizAnswer({
        recordQuizAnswer: mockRecordAnswer,
        advanceToNextQuizQuestion: mockAdvance,
      });
    });

    it('should coordinate record and advance', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        messageId: 'msg-1',
        questionUuid: 'q-123',
        answer: 'Great',
      });

      expect(result.success).toBe(true);
      expect(mockRecordAnswer.execute).toHaveBeenCalled();
      expect(mockAdvance.execute).toHaveBeenCalled();
    });

    it('should mark queue item as sent', async () => {
      const mockQueueRepo = createMockQueueRepository();
      
      const useCaseWithQueue = new HandleQuizAnswer({
        recordQuizAnswer: mockRecordAnswer,
        advanceToNextQuizQuestion: mockAdvance,
        messageQueueRepository: mockQueueRepo,
      });

      await useCaseWithQueue.execute({
        chatId: 'chat-1',
        messageId: 'msg-1',
        questionUuid: 'q-123',
        answer: 'Great',
        queueUuid: 'queue-1',
      });

      expect(mockQueueRepo.markSent).toHaveBeenCalledWith('queue-1', 'msg-1');
    });
  });
});
