/**
 * Journalist Analysis & Export Tests
 * @group journalist
 * @group Phase5
 */

import { jest } from '@jest/globals';
import { GenerateTherapistAnalysis } from '../../bots/journalist/application/usecases/GenerateTherapistAnalysis.mjs';
import { ReviewJournalEntries } from '../../bots/journalist/application/usecases/ReviewJournalEntries.mjs';
import { ExportJournalMarkdown } from '../../bots/journalist/application/usecases/ExportJournalMarkdown.mjs';

// Mock dependencies
const createMockMessagingGateway = () => ({
  sendMessage: jest.fn().mockResolvedValue({ messageId: 'msg-123' }),
});

const createMockAIGateway = () => ({
  chat: jest.fn().mockResolvedValue('Here is a thoughtful analysis of your journaling patterns. You show great self-awareness.'),
});

const createMockJournalEntryRepository = () => ({
  getMessageHistory: jest.fn().mockResolvedValue([
    { senderName: 'User', text: 'Today was challenging but I learned a lot.', timestamp: '2024-12-13T10:00:00Z' },
    { senderName: 'Journalist', text: 'What did you learn?', timestamp: '2024-12-13T10:01:00Z' },
    { senderName: 'User', text: 'I learned to be more patient.', timestamp: '2024-12-13T10:02:00Z' },
  ]),
  findByDateRange: jest.fn().mockResolvedValue([
    { date: '2024-12-13', text: 'Entry 1', period: 'morning', createdAt: '2024-12-13T10:00:00Z' },
    { date: '2024-12-13', text: 'Entry 2', period: 'evening', createdAt: '2024-12-13T18:00:00Z' },
    { date: '2024-12-12', text: 'Entry 3', period: 'afternoon', createdAt: '2024-12-12T14:00:00Z' },
  ]),
  findRecent: jest.fn().mockResolvedValue([]),
  findAll: jest.fn().mockResolvedValue([]),
});

describe('Journalist Analysis Use Cases', () => {
  describe('GenerateTherapistAnalysis', () => {
    let useCase;
    let mockMessagingGateway;
    let mockAIGateway;
    let mockJournalRepo;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();
      mockAIGateway = createMockAIGateway();
      mockJournalRepo = createMockJournalEntryRepository();

      useCase = new GenerateTherapistAnalysis({
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAIGateway,
        journalEntryRepository: mockJournalRepo,
      });
    });

    it('should require dependencies', () => {
      expect(() => new GenerateTherapistAnalysis({})).toThrow('messagingGateway');
    });

    it('should generate analysis', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
      });

      expect(result.success).toBe(true);
      expect(result.analysis).toBeDefined();
      expect(mockAIGateway.chat).toHaveBeenCalled();
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-1',
        expect.stringContaining('📘'),
        expect.any(Object)
      );
    });

    it('should handle insufficient history', async () => {
      mockJournalRepo.getMessageHistory.mockResolvedValue([]);

      const result = await useCase.execute({
        chatId: 'chat-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient');
    });
  });

  describe('ReviewJournalEntries', () => {
    let useCase;
    let mockMessagingGateway;
    let mockJournalRepo;

    beforeEach(() => {
      mockMessagingGateway = createMockMessagingGateway();
      mockJournalRepo = createMockJournalEntryRepository();

      useCase = new ReviewJournalEntries({
        messagingGateway: mockMessagingGateway,
        journalEntryRepository: mockJournalRepo,
      });
    });

    it('should review entries', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
      });

      expect(result.success).toBe(true);
      expect(result.entryCount).toBe(3);
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-1',
        expect.stringContaining('Journal Review'),
        expect.any(Object)
      );
    });

    it('should group entries by date', async () => {
      const result = await useCase.execute({
        chatId: 'chat-1',
      });

      const sentMessage = mockMessagingGateway.sendMessage.mock.calls[0][1];
      // Should have multiple date headers
      expect(sentMessage).toContain('Dec');
    });

    it('should handle no entries', async () => {
      mockJournalRepo.findByDateRange.mockResolvedValue([]);

      const result = await useCase.execute({
        chatId: 'chat-1',
      });

      expect(result.success).toBe(true);
      expect(result.entryCount).toBe(0);
    });
  });

  describe('ExportJournalMarkdown', () => {
    let useCase;
    let mockJournalRepo;

    beforeEach(() => {
      mockJournalRepo = createMockJournalEntryRepository();
      mockJournalRepo.findByDateRange.mockResolvedValue([
        { date: '2024-12-13', text: 'Today was good.', period: 'morning' },
        { date: '2024-12-13', text: 'Evening reflection.', period: 'evening' },
        { date: '2024-12-12', text: 'Yesterday entry.', period: 'afternoon' },
      ]);

      useCase = new ExportJournalMarkdown({
        journalEntryRepository: mockJournalRepo,
      });
    });

    it('should export as markdown', async () => {
      const markdown = await useCase.execute({
        chatId: 'chat-1',
        startDate: '2024-12-01',
      });

      expect(markdown).toContain('# Journal');
      expect(markdown).toContain('## ');
      expect(markdown).toContain('*');
    });

    it('should include entries', async () => {
      const markdown = await useCase.execute({
        chatId: 'chat-1',
        startDate: '2024-12-01',
      });

      expect(markdown).toContain('Today was good');
      expect(markdown).toContain('Evening reflection');
    });

    it('should handle no entries', async () => {
      mockJournalRepo.findByDateRange.mockResolvedValue([]);

      const markdown = await useCase.execute({
        chatId: 'chat-1',
        startDate: '2024-12-01',
      });

      expect(markdown).toContain('No entries found');
    });
  });
});
