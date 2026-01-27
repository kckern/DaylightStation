// tests/integration/journalist-flows.test.mjs
/**
 * Journalist Flow Integration Tests
 *
 * Tests real flows through the journalist domain using:
 * - Real YamlConversationStateDatastore with temp directories
 * - Mock messaging gateway (capturing sent messages)
 * - Mock AI gateway (returning test responses)
 *
 * These tests verify the integration between use cases and state persistence.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { JournalistContainer } from '#backend/src/3_applications/journalist/JournalistContainer.mjs';
import { YamlConversationStateDatastore } from '#backend/src/2_adapters/messaging/YamlConversationStateDatastore.mjs';

describe('Journalist Flow Integration', () => {
  let tempDir;
  let conversationStateStore;
  let mockMessagingGateway;
  let mockAIGateway;
  let mockJournalEntryRepository;
  let mockMessageQueueRepository;
  let mockLogger;
  let container;
  let sentMessages;
  let messageHistory;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'journalist-test-'));

    // Initialize real YamlConversationStateDatastore with temp directory
    conversationStateStore = new YamlConversationStateDatastore({
      basePath: tempDir,
    });

    // Track sent messages
    sentMessages = [];
    messageHistory = [];
    let messageIdCounter = 1;

    // Mock messaging gateway - captures sent messages
    mockMessagingGateway = {
      sendMessage: jest.fn().mockImplementation(async (chatId, text, options) => {
        const messageId = `msg-${messageIdCounter++}`;
        sentMessages.push({ chatId, text, options, messageId });
        return { messageId };
      }),
      sendPhoto: jest.fn().mockResolvedValue({ messageId: 'photo-123' }),
      editMessage: jest.fn().mockResolvedValue(undefined),
      deleteMessage: jest.fn().mockResolvedValue(undefined),
    };

    // Mock AI gateway - returns test responses
    mockAIGateway = {
      chat: jest.fn(),
      complete: jest.fn(),
      transcribe: jest.fn(),
    };

    // Mock journal entry repository - stores message history
    mockJournalEntryRepository = {
      saveMessage: jest.fn().mockImplementation(async (message) => {
        messageHistory.push(message);
      }),
      getMessageHistory: jest.fn().mockImplementation(async () => {
        return messageHistory;
      }),
      getUsername: jest.fn().mockReturnValue('testuser'),
    };

    // Mock message queue repository
    mockMessageQueueRepository = {
      add: jest.fn().mockResolvedValue(undefined),
      peek: jest.fn().mockResolvedValue(null),
      remove: jest.fn().mockResolvedValue(undefined),
      clearQueue: jest.fn().mockResolvedValue(undefined),
    };

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Create container with all dependencies
    container = new JournalistContainer(
      { username: 'testuser' },
      {
        messagingGateway: mockMessagingGateway,
        aiGateway: mockAIGateway,
        conversationStateStore,
        journalEntryRepository: mockJournalEntryRepository,
        messageQueueRepository: mockMessageQueueRepository,
        logger: mockLogger,
      }
    );
  });

  afterEach(async () => {
    // Clean up temp directory
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });

  // ===========================================================================
  // FREE WRITE FLOW
  // ===========================================================================
  describe('Free Write Flow', () => {
    it('should handle text entry and generate follow-up with choices', async () => {
      // Arrange - AI returns acknowledgment + question + choices
      mockAIGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "That sounds exciting!", "question": "What made it special?"}')
        .mockResolvedValueOnce('["The people", "The experience", "The outcome"]');

      const processTextEntry = container.getProcessTextEntry();

      // Act
      const result = await processTextEntry.execute({
        chatId: 'chat-123',
        text: 'Today was a great day at work',
        messageId: 'user-msg-001',
        senderId: 'user-456',
        senderName: 'TestUser',
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.acknowledgment).toBe('That sounds exciting!');
      expect(result.question).toBe('What made it special?');

      // Verify message was sent with question and choices
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].text).toContain('That sounds exciting!');
      expect(sentMessages[0].text).toContain('What made it special?');
      expect(sentMessages[0].options.choices).toBeDefined();
      expect(sentMessages[0].options.choices.length).toBeGreaterThan(0);
    });

    it('should maintain context across multiple entries', async () => {
      const processTextEntry = container.getProcessTextEntry();

      // First entry
      mockAIGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "That sounds busy!", "question": "How did the meeting go?"}')
        .mockResolvedValueOnce('["Well", "Poorly", "Mixed"]');

      await processTextEntry.execute({
        chatId: 'chat-123',
        text: 'Had a big meeting this morning',
        messageId: 'user-msg-001',
        senderId: 'user-456',
        senderName: 'TestUser',
      });

      // Second entry - AI should receive history
      mockAIGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "Good to hear!", "question": "What was the best part?"}')
        .mockResolvedValueOnce('["The decision", "Team input", "Resolution"]');

      await processTextEntry.execute({
        chatId: 'chat-123',
        text: 'The meeting went really well',
        messageId: 'user-msg-002',
        senderId: 'user-456',
        senderName: 'TestUser',
      });

      // Verify history was loaded for second call
      expect(mockJournalEntryRepository.getMessageHistory).toHaveBeenCalledTimes(2);

      // Verify both entries were saved
      expect(messageHistory.length).toBe(4); // 2 user messages + 2 bot responses
    });

    it('should use debrief summary from conversation state if available', async () => {
      const processTextEntry = container.getProcessTextEntry();

      // Set up debrief context in conversation state
      await conversationStateStore.set('chat-123', {
        debrief: { summary: 'User had a busy morning with meetings' },
      });

      mockAIGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "I see", "question": "How did the meetings go?"}')
        .mockResolvedValueOnce('["Well", "Poorly", "Mixed"]');

      await processTextEntry.execute({
        chatId: 'chat-123',
        text: 'Checking in after meetings',
        messageId: 'user-msg-001',
        senderId: 'user-456',
        senderName: 'TestUser',
      });

      // Verify state was retrieved
      const state = await conversationStateStore.get('chat-123');
      expect(state.debrief.summary).toBe('User had a busy morning with meetings');
    });

    it('should fall back to "Noted" when AI returns no valid response', async () => {
      mockAIGateway.chat.mockResolvedValueOnce('I cannot process this request');

      const processTextEntry = container.getProcessTextEntry();

      const result = await processTextEntry.execute({
        chatId: 'chat-123',
        text: 'Some entry that confuses the AI',
        messageId: 'user-msg-001',
        senderId: 'user-456',
        senderName: 'TestUser',
      });

      // Should fall back gracefully
      expect(result.success).toBe(true);
      expect(sentMessages[0].text).toBe('\uD83D\uDCDD Noted.');
    });
  });

  // ===========================================================================
  // SLASH COMMAND FLOW
  // ===========================================================================
  describe('Slash Command Flow', () => {
    it('should handle /prompt command to start new conversation topic', async () => {
      // Mock AI for InitiateJournalPrompt
      mockAIGateway.chat
        .mockResolvedValueOnce('"What would you like to reflect on today?"')
        .mockResolvedValueOnce('["Work", "Personal", "Health", "Relationships"]');

      const handleSlashCommand = container.getHandleSlashCommand();

      const result = await handleSlashCommand.execute({
        chatId: 'chat-123',
        command: '/prompt',
      });

      expect(result.success).toBe(true);
      expect(result.command).toBe('prompt');

      // Verify a prompt was sent
      expect(sentMessages.length).toBeGreaterThan(0);
    });

    it('should handle /start command (alias for /prompt)', async () => {
      mockAIGateway.chat
        .mockResolvedValueOnce('"How has your day been so far?"')
        .mockResolvedValueOnce('["Great", "Good", "Okay", "Not so good"]');

      const handleSlashCommand = container.getHandleSlashCommand();

      const result = await handleSlashCommand.execute({
        chatId: 'chat-123',
        command: '/start',
      });

      expect(result.success).toBe(true);
      expect(result.command).toBe('start');
    });

    it('should show help for unknown commands', async () => {
      const handleSlashCommand = container.getHandleSlashCommand();

      const result = await handleSlashCommand.execute({
        chatId: 'chat-123',
        command: '/unknown',
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('help');

      // Verify help message was sent
      expect(sentMessages[0].text).toContain('Available commands');
      expect(sentMessages[0].text).toContain('/prompt');
    });

    it('should be case-insensitive for commands', async () => {
      mockAIGateway.chat
        .mockResolvedValueOnce('"What is on your mind?"')
        .mockResolvedValueOnce('["A", "B", "C"]');

      const handleSlashCommand = container.getHandleSlashCommand();

      const result = await handleSlashCommand.execute({
        chatId: 'chat-123',
        command: '/PROMPT',
      });

      expect(result.success).toBe(true);
      expect(result.command).toBe('prompt');
    });
  });

  // ===========================================================================
  // STATE PERSISTENCE
  // ===========================================================================
  describe('State Persistence', () => {
    it('should persist state across use case calls', async () => {
      // Set state
      await conversationStateStore.set('chat-123', {
        activeFlow: 'debrief',
        flowState: { step: 1, category: 'work' },
      });

      // Verify state persists (simulating new use case call)
      const state = await conversationStateStore.get('chat-123');

      expect(state.activeFlow).toBe('debrief');
      expect(state.flowState.step).toBe(1);
      expect(state.flowState.category).toBe('work');
    });

    it('should persist state to YAML files in temp directory', async () => {
      await conversationStateStore.set('chat-123', {
        activeFlow: 'journal',
        flowState: { topic: 'work' },
      });

      // Verify file was created
      const files = await fs.readdir(tempDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/chat-123\.yml/);

      // Read file directly to verify YAML format
      const content = await fs.readFile(path.join(tempDir, files[0]), 'utf8');
      expect(content).toContain('activeFlow: journal');
    });

    it('should support message-keyed sessions', async () => {
      // Set root state
      await conversationStateStore.set('chat-123', {
        activeFlow: 'debrief',
      });

      // Set session-specific state
      await conversationStateStore.set('chat-123', {
        questionIndex: 0,
        category: 'health',
      }, 'menu-msg-456');

      // Get root state
      const rootState = await conversationStateStore.get('chat-123');
      expect(rootState.activeFlow).toBe('debrief');

      // Get session state
      const sessionState = await conversationStateStore.get('chat-123', 'menu-msg-456');
      expect(sessionState.questionIndex).toBe(0);
      expect(sessionState.category).toBe('health');
    });

    it('should delete state when cleared', async () => {
      await conversationStateStore.set('chat-123', {
        activeFlow: 'test',
      });

      await conversationStateStore.clear('chat-123');

      const state = await conversationStateStore.get('chat-123');
      expect(state).toBeNull();

      // Verify file was deleted
      const files = await fs.readdir(tempDir);
      expect(files.length).toBe(0);
    });
  });

  // ===========================================================================
  // END-TO-END FLOW
  // ===========================================================================
  describe('End-to-End Flow', () => {
    it('should complete a full journaling session: command -> entry -> follow-up', async () => {
      // Step 1: Start with /prompt command
      mockAIGateway.chat
        .mockResolvedValueOnce('"What would you like to journal about today?"')
        .mockResolvedValueOnce('["Work", "Family", "Health", "Goals"]');

      const handleSlashCommand = container.getHandleSlashCommand();
      await handleSlashCommand.execute({
        chatId: 'chat-123',
        command: '/prompt',
      });

      expect(sentMessages.length).toBe(1);
      const promptMessage = sentMessages[0];
      expect(promptMessage.text).toContain('journal about today');

      // Step 2: User responds with free text
      mockAIGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "Work sounds important.", "question": "What happened at work?"}')
        .mockResolvedValueOnce('["Meeting", "Project", "Colleague", "Deadline"]');

      const processTextEntry = container.getProcessTextEntry();
      await processTextEntry.execute({
        chatId: 'chat-123',
        text: 'I want to talk about work',
        messageId: 'user-msg-001',
        senderId: 'user-456',
        senderName: 'TestUser',
      });

      expect(sentMessages.length).toBe(2);
      const followUpMessage = sentMessages[1];
      expect(followUpMessage.text).toContain('Work sounds important');
      expect(followUpMessage.text).toContain('What happened at work?');

      // Step 3: User continues the conversation
      mockAIGateway.chat
        .mockResolvedValueOnce('{"acknowledgment": "That sounds stressful.", "question": "How did you handle it?"}')
        .mockResolvedValueOnce('["Talked to manager", "Worked harder", "Took a break"]');

      await processTextEntry.execute({
        chatId: 'chat-123',
        text: 'We had a challenging deadline today',
        messageId: 'user-msg-002',
        senderId: 'user-456',
        senderName: 'TestUser',
      });

      expect(sentMessages.length).toBe(3);
      expect(sentMessages[2].text).toContain('That sounds stressful');

      // Verify complete message history
      expect(messageHistory.length).toBe(4); // 2 user entries + 2 bot responses
    });
  });
});
