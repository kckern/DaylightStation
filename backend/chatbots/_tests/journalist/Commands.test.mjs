/**
 * Journalist Command Use Cases Tests
 * @group journalist
 * @group Phase5
 */

import { jest } from '@jest/globals';
import { HandleSlashCommand } from '../../journalist/application/usecases/HandleSlashCommand.mjs';
import { HandleSpecialStart } from '../../journalist/application/usecases/HandleSpecialStart.mjs';

// Mock dependencies
const createMockMessagingGateway = () => ({
  sendMessage: jest.fn().mockResolvedValue({ messageId: 'msg-123' }),
  deleteMessage: jest.fn().mockResolvedValue(undefined),
});

describe('Journalist Command Use Cases', () => {
  describe('HandleSlashCommand', () => {
    let useCase;
    let mockInitiatePrompt;
    let mockAnalysis;
    let mockReview;

    beforeEach(() => {
      mockInitiatePrompt = {
        execute: jest.fn().mockResolvedValue({ success: true, prompt: 'How are you?' }),
      };
      mockAnalysis = {
        execute: jest.fn().mockResolvedValue({ success: true, analysis: 'Analysis...' }),
      };
      mockReview = {
        execute: jest.fn().mockResolvedValue({ success: true, entryCount: 5 }),
      };

      useCase = new HandleSlashCommand({
        initiateJournalPrompt: mockInitiatePrompt,
        generateTherapistAnalysis: mockAnalysis,
        reviewJournalEntries: mockReview,
      });
    });

    it('should route /journal command', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        command: '/journal',
      });

      expect(result.success).toBe(true);
      expect(result.command).toBe('journal');
      expect(mockInitiatePrompt.execute).toHaveBeenCalled();
    });

    it('should route /analyze command', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        command: '/analyze',
      });

      expect(result.success).toBe(true);
      expect(result.command).toBe('analyze');
      expect(mockAnalysis.execute).toHaveBeenCalled();
    });

    it('should route /review command', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        command: '/review',
      });

      expect(result.success).toBe(true);
      expect(result.command).toBe('review');
      expect(mockReview.execute).toHaveBeenCalled();
    });

    it('should handle command without slash', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        command: 'journal',
      });

      expect(result.success).toBe(true);
      expect(result.command).toBe('journal');
    });

    it('should route /yesterday with instructions', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        command: '/yesterday',
      });

      expect(result.success).toBe(true);
      expect(mockInitiatePrompt.execute).toHaveBeenCalledWith({
        chatId: 'chat-1',
        instructions: 'yesterday',
      });
    });

    it('should default to journal prompt for unknown commands', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        command: '/unknown',
      });

      expect(result.success).toBe(true);
      expect(mockInitiatePrompt.execute).toHaveBeenCalled();
    });
  });

  describe('HandleSpecialStart', () => {
    let useCase;
    let mockMessagingGateway;
    let mockQueueRepo;
    let mockInitiatePrompt;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();
      mockQueueRepo = {
        deleteUnprocessed: jest.fn().mockResolvedValue(undefined),
      };
      mockInitiatePrompt = {
        execute: jest.fn().mockResolvedValue({ success: true }),
      };

      useCase = new HandleSpecialStart({
        messagingGateway: mockMessagingGateway,
        messageQueueRepository: mockQueueRepo,
        initiateJournalPrompt: mockInitiatePrompt,
      });
    });

    it('should handle roll (🎲)', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        messageId: 'msg-1',
        text: '🎲 Change Subject',
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('roll');
      expect(mockInitiatePrompt.execute).toHaveBeenCalledWith({
        chatId: 'chat-1',
        instructions: 'change_subject',
      });
    });

    it('should handle cancel (❌)', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        messageId: 'msg-1',
        text: '❌ Cancel',
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('cancel');
      expect(mockInitiatePrompt.execute).not.toHaveBeenCalled();
    });

    it('should delete queue on special start', async () => {
      await useCase.execute({
        chatId: 'chat-1',
        messageId: 'msg-1',
        text: '🎲',
      });

      expect(mockQueueRepo.deleteUnprocessed).toHaveBeenCalledWith('chat-1');
    });

    it('should delete user message', async () => {
      await useCase.execute({
        chatId: 'chat-1',
        messageId: 'msg-1',
        text: '❌',
      });

      expect(mockMessagingGateway.deleteMessage).toHaveBeenCalledWith('chat-1', 'msg-1');
    });

    describe('isSpecialStart', () => {
      it('should detect 🎲', () => {
        expect(HandleSpecialStart.isSpecialStart('🎲')).toBe(true);
        expect(HandleSpecialStart.isSpecialStart('🎲 Change Subject')).toBe(true);
      });

      it('should detect ❌', () => {
        expect(HandleSpecialStart.isSpecialStart('❌')).toBe(true);
        expect(HandleSpecialStart.isSpecialStart('❌ Cancel')).toBe(true);
      });

      it('should detect text versions', () => {
        expect(HandleSpecialStart.isSpecialStart('change subject')).toBe(true);
        expect(HandleSpecialStart.isSpecialStart('Cancel')).toBe(true);
        expect(HandleSpecialStart.isSpecialStart('roll')).toBe(true);
      });

      it('should return false for normal text', () => {
        expect(HandleSpecialStart.isSpecialStart('Hello')).toBe(false);
        expect(HandleSpecialStart.isSpecialStart('')).toBe(false);
        expect(HandleSpecialStart.isSpecialStart(null)).toBe(false);
      });
    });
  });
});
