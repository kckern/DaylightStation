// tests/unit/applications/journalist/usecases/HandleSlashCommand.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('HandleSlashCommand', () => {
  let HandleSlashCommand;
  let useCase;
  let mockInitiateJournalPrompt;
  let mockGenerateTherapistAnalysis;
  let mockGenerateMorningDebrief;
  let mockSendMorningDebrief;
  let mockMessagingGateway;
  let mockLogger;

  beforeEach(async () => {
    // Reset mocks
    mockInitiateJournalPrompt = {
      execute: jest.fn().mockResolvedValue({ success: true, action: 'journal_prompt' }),
    };

    mockGenerateTherapistAnalysis = {
      execute: jest.fn().mockResolvedValue({ success: true, action: 'therapist_analysis' }),
    };

    mockGenerateMorningDebrief = {
      execute: jest.fn().mockResolvedValue({
        date: '2024-01-15',
        summary: 'Yesterday was productive',
        categories: [],
        questions: {},
      }),
    };

    mockSendMorningDebrief = {
      execute: jest.fn().mockResolvedValue({ success: true, messageId: 'debrief-msg-123' }),
    };

    mockMessagingGateway = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: 'sent-msg-123' }),
      deleteMessage: jest.fn().mockResolvedValue(undefined),
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Dynamic import after mocks are set up
    const module = await import('@backend/src/3_applications/journalist/usecases/HandleSlashCommand.mjs');
    HandleSlashCommand = module.HandleSlashCommand;
  });

  describe('constructor', () => {
    it('should create instance with all dependencies', () => {
      const instance = new HandleSlashCommand({
        initiateJournalPrompt: mockInitiateJournalPrompt,
        generateTherapistAnalysis: mockGenerateTherapistAnalysis,
        generateMorningDebrief: mockGenerateMorningDebrief,
        sendMorningDebrief: mockSendMorningDebrief,
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });
      expect(instance).toBeInstanceOf(HandleSlashCommand);
    });

    it('should create instance without optional logger', () => {
      const instance = new HandleSlashCommand({
        initiateJournalPrompt: mockInitiateJournalPrompt,
        generateTherapistAnalysis: mockGenerateTherapistAnalysis,
        generateMorningDebrief: mockGenerateMorningDebrief,
        sendMorningDebrief: mockSendMorningDebrief,
        messagingGateway: mockMessagingGateway,
      });
      expect(instance).toBeInstanceOf(HandleSlashCommand);
    });

    it('should create instance with minimal dependencies', () => {
      const instance = new HandleSlashCommand({
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });
      expect(instance).toBeInstanceOf(HandleSlashCommand);
    });
  });

  describe('execute - /prompt command (journal)', () => {
    beforeEach(() => {
      useCase = new HandleSlashCommand({
        initiateJournalPrompt: mockInitiateJournalPrompt,
        generateTherapistAnalysis: mockGenerateTherapistAnalysis,
        generateMorningDebrief: mockGenerateMorningDebrief,
        sendMorningDebrief: mockSendMorningDebrief,
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });
    });

    it('should call InitiateJournalPrompt for /prompt command', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: '/prompt',
      });

      expect(mockInitiateJournalPrompt.execute).toHaveBeenCalledWith({
        chatId: 'chat-123',
        instructions: 'change_subject',
      });
      expect(result.success).toBe(true);
      expect(result.command).toBe('prompt');
    });

    it('should call InitiateJournalPrompt for /start command', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: '/start',
      });

      expect(mockInitiateJournalPrompt.execute).toHaveBeenCalledWith({
        chatId: 'chat-123',
        instructions: 'change_subject',
      });
      expect(result.success).toBe(true);
      expect(result.command).toBe('start');
    });

    it('should handle command without leading slash', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: 'prompt',
      });

      expect(mockInitiateJournalPrompt.execute).toHaveBeenCalledWith({
        chatId: 'chat-123',
        instructions: 'change_subject',
      });
      expect(result.command).toBe('prompt');
    });

    it('should handle command with trailing whitespace', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: '/prompt  ',
      });

      expect(mockInitiateJournalPrompt.execute).toHaveBeenCalled();
      expect(result.command).toBe('prompt');
    });

    it('should be case insensitive', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: '/PROMPT',
      });

      expect(mockInitiateJournalPrompt.execute).toHaveBeenCalled();
      expect(result.command).toBe('prompt');
    });
  });

  describe('execute - /counsel command (therapist analysis)', () => {
    beforeEach(() => {
      useCase = new HandleSlashCommand({
        initiateJournalPrompt: mockInitiateJournalPrompt,
        generateTherapistAnalysis: mockGenerateTherapistAnalysis,
        generateMorningDebrief: mockGenerateMorningDebrief,
        sendMorningDebrief: mockSendMorningDebrief,
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });
    });

    it('should call GenerateTherapistAnalysis for /counsel command', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: '/counsel',
      });

      expect(mockGenerateTherapistAnalysis.execute).toHaveBeenCalledWith({
        chatId: 'chat-123',
      });
      expect(result.success).toBe(true);
      expect(result.command).toBe('counsel');
    });

    it('should call GenerateTherapistAnalysis for /therapist command', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: '/therapist',
      });

      expect(mockGenerateTherapistAnalysis.execute).toHaveBeenCalledWith({
        chatId: 'chat-123',
      });
      expect(result.command).toBe('therapist');
    });

    it('should call GenerateTherapistAnalysis for /analyze command', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: '/analyze',
      });

      expect(mockGenerateTherapistAnalysis.execute).toHaveBeenCalledWith({
        chatId: 'chat-123',
      });
      expect(result.command).toBe('analyze');
    });
  });

  describe('execute - /yesterday command (debrief)', () => {
    beforeEach(() => {
      useCase = new HandleSlashCommand({
        initiateJournalPrompt: mockInitiateJournalPrompt,
        generateTherapistAnalysis: mockGenerateTherapistAnalysis,
        generateMorningDebrief: mockGenerateMorningDebrief,
        sendMorningDebrief: mockSendMorningDebrief,
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });
    });

    it('should call GenerateMorningDebrief then SendMorningDebrief for /yesterday command', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: '/yesterday',
        userId: 'testuser',
      });

      expect(mockGenerateMorningDebrief.execute).toHaveBeenCalledWith({
        username: 'testuser',
        date: null,
      });
      expect(mockSendMorningDebrief.execute).toHaveBeenCalledWith({
        conversationId: 'chat-123',
        debrief: expect.objectContaining({
          date: '2024-01-15',
          summary: 'Yesterday was productive',
        }),
      });
      expect(result.success).toBe(true);
      expect(result.command).toBe('yesterday');
    });

    it('should use default username when userId is not provided', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: '/yesterday',
      });

      expect(mockGenerateMorningDebrief.execute).toHaveBeenCalledWith({
        username: 'kckern', // default fallback
        date: null,
      });
      expect(result.success).toBe(true);
    });

    it('should send fallback message when debrief handlers are not available', async () => {
      const useCaseNoDebrief = new HandleSlashCommand({
        initiateJournalPrompt: mockInitiateJournalPrompt,
        generateTherapistAnalysis: mockGenerateTherapistAnalysis,
        // No generateMorningDebrief or sendMorningDebrief
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });

      const result = await useCaseNoDebrief.execute({
        chatId: 'chat-123',
        command: '/yesterday',
      });

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        '📅 Morning debrief is not configured yet.',
        {}
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Debrief not available');
    });

    it('should send fallback message when only generateMorningDebrief is provided', async () => {
      const useCasePartialDebrief = new HandleSlashCommand({
        generateMorningDebrief: mockGenerateMorningDebrief,
        // No sendMorningDebrief
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });

      const result = await useCasePartialDebrief.execute({
        chatId: 'chat-123',
        command: '/yesterday',
      });

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        '📅 Morning debrief is not configured yet.',
        {}
      );
      expect(result.success).toBe(false);
    });
  });

  describe('execute - unknown command', () => {
    beforeEach(() => {
      useCase = new HandleSlashCommand({
        initiateJournalPrompt: mockInitiateJournalPrompt,
        generateTherapistAnalysis: mockGenerateTherapistAnalysis,
        generateMorningDebrief: mockGenerateMorningDebrief,
        sendMorningDebrief: mockSendMorningDebrief,
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });
    });

    it('should show help message for unknown command', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: '/unknown',
      });

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        '📝 Available commands:\n' +
          '/prompt - Start a new conversation topic\n' +
          "/yesterday - Review yesterday's activities\n" +
          '/counsel - Get insights and observations',
        {}
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe('help');
      expect(result.command).toBe('unknown');
    });

    it('should handle empty command gracefully', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: '/',
      });

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalled();
      expect(result.action).toBe('help');
    });

    it('should handle command with only spaces gracefully', async () => {
      const result = await useCase.execute({
        chatId: 'chat-123',
        command: '/   ',
      });

      expect(mockMessagingGateway.sendMessage).toHaveBeenCalled();
      expect(result.action).toBe('help');
    });
  });

  describe('execute - handler not available', () => {
    it('should return error when prompt handler is not available', async () => {
      const useCaseNoPrompt = new HandleSlashCommand({
        // No initiateJournalPrompt
        generateTherapistAnalysis: mockGenerateTherapistAnalysis,
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });

      const result = await useCaseNoPrompt.execute({
        chatId: 'chat-123',
        command: '/prompt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command handler not available');
      expect(result.command).toBe('prompt');
    });

    it('should return error when therapist handler is not available', async () => {
      const useCaseNoTherapist = new HandleSlashCommand({
        initiateJournalPrompt: mockInitiateJournalPrompt,
        // No generateTherapistAnalysis
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });

      const result = await useCaseNoTherapist.execute({
        chatId: 'chat-123',
        command: '/counsel',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command handler not available');
      expect(result.command).toBe('counsel');
    });
  });

  describe('execute - error handling', () => {
    beforeEach(() => {
      useCase = new HandleSlashCommand({
        initiateJournalPrompt: mockInitiateJournalPrompt,
        generateTherapistAnalysis: mockGenerateTherapistAnalysis,
        generateMorningDebrief: mockGenerateMorningDebrief,
        sendMorningDebrief: mockSendMorningDebrief,
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });
    });

    it('should log error and rethrow when prompt handler fails', async () => {
      const testError = new Error('Journal prompt failed');
      mockInitiateJournalPrompt.execute.mockRejectedValueOnce(testError);

      await expect(
        useCase.execute({
          chatId: 'chat-123',
          command: '/prompt',
        })
      ).rejects.toThrow('Journal prompt failed');

      expect(mockLogger.error).toHaveBeenCalledWith('command.slash.error', {
        chatId: 'chat-123',
        command: 'prompt',
        error: 'Journal prompt failed',
      });
    });

    it('should log error and rethrow when therapist handler fails', async () => {
      const testError = new Error('Therapist analysis failed');
      mockGenerateTherapistAnalysis.execute.mockRejectedValueOnce(testError);

      await expect(
        useCase.execute({
          chatId: 'chat-123',
          command: '/counsel',
        })
      ).rejects.toThrow('Therapist analysis failed');

      expect(mockLogger.error).toHaveBeenCalledWith('command.slash.error', {
        chatId: 'chat-123',
        command: 'counsel',
        error: 'Therapist analysis failed',
      });
    });

    it('should log error and rethrow when debrief generation fails', async () => {
      const testError = new Error('Debrief generation failed');
      mockGenerateMorningDebrief.execute.mockRejectedValueOnce(testError);

      await expect(
        useCase.execute({
          chatId: 'chat-123',
          command: '/yesterday',
        })
      ).rejects.toThrow('Debrief generation failed');

      expect(mockLogger.error).toHaveBeenCalledWith('command.slash.error', {
        chatId: 'chat-123',
        command: 'yesterday',
        error: 'Debrief generation failed',
      });
    });

    it('should log error and rethrow when debrief sending fails', async () => {
      const testError = new Error('Debrief send failed');
      mockSendMorningDebrief.execute.mockRejectedValueOnce(testError);

      await expect(
        useCase.execute({
          chatId: 'chat-123',
          command: '/yesterday',
        })
      ).rejects.toThrow('Debrief send failed');

      expect(mockLogger.error).toHaveBeenCalledWith('command.slash.error', {
        chatId: 'chat-123',
        command: 'yesterday',
        error: 'Debrief send failed',
      });
    });
  });

  describe('execute - logging', () => {
    beforeEach(() => {
      useCase = new HandleSlashCommand({
        initiateJournalPrompt: mockInitiateJournalPrompt,
        generateTherapistAnalysis: mockGenerateTherapistAnalysis,
        generateMorningDebrief: mockGenerateMorningDebrief,
        sendMorningDebrief: mockSendMorningDebrief,
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });
    });

    it('should log debug on start', async () => {
      await useCase.execute({
        chatId: 'chat-123',
        command: '/prompt',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith('command.slash.start', {
        chatId: 'chat-123',
        command: 'prompt',
      });
    });

    it('should log info on completion', async () => {
      await useCase.execute({
        chatId: 'chat-123',
        command: '/prompt',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('command.slash.complete', {
        chatId: 'chat-123',
        command: 'prompt',
        success: true,
      });
    });

    it('should log completion with success=false when handler not available', async () => {
      const useCaseNoHandlers = new HandleSlashCommand({
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });

      await useCaseNoHandlers.execute({
        chatId: 'chat-123',
        command: '/prompt',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('command.slash.complete', {
        chatId: 'chat-123',
        command: 'prompt',
        success: false,
      });
    });
  });

  describe('execute - command parsing', () => {
    beforeEach(() => {
      useCase = new HandleSlashCommand({
        initiateJournalPrompt: mockInitiateJournalPrompt,
        generateTherapistAnalysis: mockGenerateTherapistAnalysis,
        messagingGateway: mockMessagingGateway,
        logger: mockLogger,
      });
    });

    it('should parse command with arguments (ignore arguments)', async () => {
      await useCase.execute({
        chatId: 'chat-123',
        command: '/prompt some extra arguments here',
      });

      expect(mockInitiateJournalPrompt.execute).toHaveBeenCalled();
    });

    it('should parse command with multiple slashes (take first part)', async () => {
      await useCase.execute({
        chatId: 'chat-123',
        command: '/prompt/extra',
      });

      // The split on whitespace will leave 'prompt/extra', so baseCmd will be 'prompt/extra'
      // and it won't match, triggering help
      expect(mockMessagingGateway.sendMessage).toHaveBeenCalled();
    });
  });
});
