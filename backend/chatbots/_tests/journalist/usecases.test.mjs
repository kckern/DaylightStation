/**
 * Journalist Use Cases Tests
 * @group journalist
 * @group Phase4
 */

import { jest } from '@jest/globals';
import { ProcessTextEntry } from '../../bots/journalist/application/usecases/ProcessTextEntry.mjs';
import { ProcessVoiceEntry } from '../../bots/journalist/application/usecases/ProcessVoiceEntry.mjs';
import { InitiateJournalPrompt } from '../../bots/journalist/application/usecases/InitiateJournalPrompt.mjs';
import { GenerateMultipleChoices } from '../../bots/journalist/application/usecases/GenerateMultipleChoices.mjs';
import { HandleCallbackResponse } from '../../bots/journalist/application/usecases/HandleCallbackResponse.mjs';

// Mock dependencies
const createMockMessagingGateway = () => ({
  sendMessage: jest.fn().mockResolvedValue({ messageId: 'msg-123' }),
  updateMessage: jest.fn().mockResolvedValue(undefined),
  updateKeyboard: jest.fn().mockResolvedValue(undefined),
  deleteMessage: jest.fn().mockResolvedValue(undefined),
  transcribeVoice: jest.fn().mockResolvedValue('Transcribed text from voice'),
});

const createMockAIGateway = () => ({
  chat: jest.fn().mockResolvedValue('What happened next?'),
});

const createMockJournalEntryRepo = () => ({
  saveMessage: jest.fn().mockResolvedValue(undefined),
  getMessageHistory: jest.fn().mockResolvedValue([]),
  getMessageById: jest.fn().mockResolvedValue(null),
});

const createMockMessageQueueRepo = () => ({
  loadUnsentQueue: jest.fn().mockResolvedValue([]),
  saveToQueue: jest.fn().mockResolvedValue(undefined),
  clearQueue: jest.fn().mockResolvedValue(undefined),
  markSent: jest.fn().mockResolvedValue(undefined),
});

describe('Journalist Use Cases', () => {
  beforeEach(() => {
    // Clear choice cache between tests
    GenerateMultipleChoices.clearCache();
  });

  describe('ProcessTextEntry', () => {
    let useCase;
    let mockMessagingGateway;
    let mockAIGateway;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();
      mockAIGateway = createMockAIGateway();

      useCase = new ProcessTextEntry({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAIGateway,
      });
    });

    it('should require dependencies', () => {
      expect(() => new ProcessTextEntry({})).toThrow('messagingGateway');
    });

    it('should process text entry and generate follow-up', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        text: 'Today was a good day.',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderName: 'Test User',
      });

      expect(result.success).toBe(true);
      expect(mockAIGateway.chat).toHaveBeenCalled();
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalled();
    });

    it('should handle acknowledgment when no questions', async () => {
      mockAIGateway.chat.mockResolvedValue('');

      const result = await useCase.execute({
        chatId: 'chat-1',
        text: 'Thanks',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderName: 'Test User',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('ProcessVoiceEntry', () => {
    let useCase;
    let mockMessagingGateway;
    let mockProcessTextEntry;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();
      mockProcessTextEntry = {
        execute: jest.fn().mockResolvedValue({ success: true }),
      };

      useCase = new ProcessVoiceEntry({
        messagingGateway: mockMessagingGateway,
        processTextEntry: mockProcessTextEntry,
      });
    });

    it('should transcribe and delegate to text processing', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        voiceFileId: 'voice-123',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderName: 'Test User',
      });

      expect(result.success).toBe(true);
      expect(result.transcription).toBe('Transcribed text from voice');
      expect(mockMessagingGateway.transcribeVoice).toHaveBeenCalledWith('voice-123');
      expect(mockProcessTextEntry.execute).toHaveBeenCalled();
    });

    it('should handle empty transcription', async () => {
      mockMessagingGateway.transcribeVoice.mockResolvedValue('');

      const result = await useCase.execute({
        chatId: 'chat-1',
        voiceFileId: 'voice-123',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderName: 'Test User',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('transcription');
    });
  });

  describe('InitiateJournalPrompt', () => {
    let useCase;
    let mockMessagingGateway;
    let mockAIGateway;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();
      mockAIGateway = createMockAIGateway();
      mockAIGateway.chat.mockResolvedValue('How are you feeling today?');

      useCase = new InitiateJournalPrompt({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAIGateway,
      });
    });

    it('should generate opening question', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
      });

      expect(result.success).toBe(true);
      expect(result.prompt).toBeDefined();
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalled();
    });

    it('should clear queue on change_subject', async () => {
      const mockQueueRepo = createMockMessageQueueRepo();
      
      const useCaseWithQueue = new InitiateJournalPrompt({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAIGateway,
        messageQueueRepository: mockQueueRepo,
      });

      await useCaseWithQueue.execute({
        chatId: 'chat-1',
        instructions: 'change_subject',
      });

      expect(mockQueueRepo.clearQueue).toHaveBeenCalledWith('chat-1');
    });
  });

  describe('GenerateMultipleChoices', () => {
    let useCase;
    let mockAIGateway;

    beforeEach(() => {
      mockAIGateway = createMockAIGateway();
      mockAIGateway.chat.mockResolvedValue('["Option 1", "Option 2", "Option 3"]');

      useCase = new GenerateMultipleChoices({
        aiGateway: mockAIGateway,
      });
    });

    it('should generate choices from AI', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        history: 'Previous conversation',
        comment: 'Context',
        question: 'How are you feeling?',
      });

      expect(result.length).toBeGreaterThan(1);
      expect(mockAIGateway.chat).toHaveBeenCalled();
    });

    it('should include default choices', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        question: 'How are you feeling?',
      });

      // Should have generated choices plus default row
      const lastRow = result[result.length - 1];
      expect(lastRow).toContain('🎲 Change Subject');
    });

    it('should cache results', async () => {
      await useCase.execute({
        chatId: 'chat-1',
        question: 'Same question?',
      });

      await useCase.execute({
        chatId: 'chat-1',
        question: 'Same question?',
      });

      // Should only call AI once due to caching
      expect(mockAIGateway.chat).toHaveBeenCalledTimes(1);
    });

    it('should return default on AI error', async () => {
      mockAIGateway.chat.mockRejectedValue(new Error('AI error'));

      const result = await useCase.execute({
        chatId: 'chat-1',
        question: 'How are you?',
      });

      expect(result).toEqual([['🎲 Change Subject', '❌ Cancel']]);
    });
  });

  describe('HandleCallbackResponse', () => {
    let useCase;
    let mockMessagingGateway;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();

      useCase = new HandleCallbackResponse({
        messagingGateway: mockMessagingGateway,
      });
    });

    it('should handle cancel callback', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
        messageId: 'msg-1',
        callbackData: '❌ Cancel',
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('cancelled');
      expect(mockMessagingGateway.updateMessage).toHaveBeenCalled();
    });

    it('should handle change subject callback', async () => {
      const mockInitiatePrompt = {
        execute: jest.fn().mockResolvedValue({ success: true }),
      };

      const useCaseWithPrompt = new HandleCallbackResponse({
        messagingGateway: mockMessagingGateway,
        initiateJournalPrompt: mockInitiatePrompt,
      });

      const result = await useCaseWithPrompt.execute({
        chatId: 'chat-1',
        messageId: 'msg-1',
        callbackData: '🎲 Change Subject',
      });

      expect(mockInitiatePrompt.execute).toHaveBeenCalledWith({
        chatId: 'chat-1',
        instructions: 'change_subject',
      });
    });

    it('should process regular callback as text', async () => {
      const mockProcessText = {
        execute: jest.fn().mockResolvedValue({ success: true }),
      };

      const useCaseWithText = new HandleCallbackResponse({
        messagingGateway: mockMessagingGateway,
        processTextEntry: mockProcessText,
      });

      const result = await useCaseWithText.execute({
        chatId: 'chat-1',
        messageId: 'msg-1',
        callbackData: 'I had a great day',
        options: { senderId: 'user-1', senderName: 'Test' },
      });

      expect(mockProcessText.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 'chat-1',
          text: 'I had a great day',
        })
      );
    });
  });
});
