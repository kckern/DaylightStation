/**
 * Journalist Domain Services Tests
 * @group journalist
 * @group Phase4
 */

import {
  formatAsChat,
  truncateToLength,
  buildChatContext,
  getRecentMessages,
  extractUserText,
} from '../../bots/journalist/domain/services/HistoryFormatter.mjs';

import {
  parseGPTResponse,
  splitMultipleQuestions,
  cleanQuestion,
  isValidQuestion,
} from '../../bots/journalist/domain/services/QuestionParser.mjs';

import {
  shouldContinueQueue,
  getNextUnsent,
  formatQuestion,
  buildDefaultChoices,
  createQueueFromQuestions,
  getUnsentCount,
} from '../../bots/journalist/domain/services/QueueManager.mjs';

import {
  buildBiographerPrompt,
  buildAutobiographerPrompt,
  buildMultipleChoicePrompt,
  buildEvaluateResponsePrompt,
} from '../../bots/journalist/domain/services/PromptBuilder.mjs';

import { ConversationMessage } from '../../bots/journalist/domain/entities/ConversationMessage.mjs';
import { MessageQueue } from '../../bots/journalist/domain/entities/MessageQueue.mjs';

describe('Journalist Domain Services', () => {
  describe('HistoryFormatter', () => {
    const createMessages = () => [
      ConversationMessage.createUserMessage({
        chatId: 'chat-1',
        senderId: 'user-1',
        senderName: 'Alice',
        text: 'Hello',
        timestamp: '2024-12-13T10:00:00.000Z',
      }),
      ConversationMessage.createBotMessage({
        chatId: 'chat-1',
        text: 'How are you?',
        timestamp: '2024-12-13T10:01:00.000Z',
      }),
    ];

    describe('formatAsChat', () => {
      it('should format messages as chat transcript', () => {
        const messages = createMessages();
        const formatted = formatAsChat(messages);
        
        expect(formatted).toContain('Alice: Hello');
        expect(formatted).toContain('Journalist: How are you?');
      });

      it('should handle empty array', () => {
        expect(formatAsChat([])).toBe('');
      });
    });

    describe('truncateToLength', () => {
      it('should not truncate short history', () => {
        const text = 'Short text';
        expect(truncateToLength(text, 100)).toBe(text);
      });

      it('should truncate long history from beginning', () => {
        const text = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
        const truncated = truncateToLength(text, 20);
        
        expect(truncated.length).toBeLessThanOrEqual(24); // 20 + "...\n"
        expect(truncated).toContain('...');
      });
    });

    describe('buildChatContext', () => {
      it('should convert messages to AI format', () => {
        const messages = createMessages();
        const context = buildChatContext(messages);
        
        expect(context).toHaveLength(2);
        expect(context[0].role).toBe('user');
        expect(context[1].role).toBe('assistant');
      });
    });

    describe('extractUserText', () => {
      it('should extract only user messages', () => {
        const messages = createMessages();
        const text = extractUserText(messages);
        
        expect(text).toBe('Hello');
        expect(text).not.toContain('How are you');
      });
    });
  });

  describe('QuestionParser', () => {
    describe('parseGPTResponse', () => {
      it('should parse JSON array', () => {
        const response = '["Question 1?", "Question 2?"]';
        const questions = parseGPTResponse(response);
        
        expect(questions).toHaveLength(2);
        expect(questions[0]).toBe('Question 1?');
      });

      it('should handle markdown-wrapped JSON', () => {
        const response = '```json\n["Question?"]\n```';
        const questions = parseGPTResponse(response);
        
        expect(questions).toHaveLength(1);
      });

      it('should split on question marks', () => {
        const response = 'What happened? How did it feel?';
        const questions = parseGPTResponse(response);
        
        expect(questions.length).toBeGreaterThanOrEqual(1);
      });

      it('should handle empty/null input', () => {
        expect(parseGPTResponse('')).toEqual([]);
        expect(parseGPTResponse(null)).toEqual([]);
      });
    });

    describe('splitMultipleQuestions', () => {
      it('should split numbered questions', () => {
        const text = '1. What happened? 2. How did you feel?';
        const questions = splitMultipleQuestions(text);
        
        expect(questions.length).toBeGreaterThanOrEqual(2);
      });

      it('should split bullet questions', () => {
        const text = '- What happened?\n- How did you feel?';
        const questions = splitMultipleQuestions(text);
        
        expect(questions.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe('cleanQuestion', () => {
      it('should remove leading numbers and bullets', () => {
        expect(cleanQuestion('1. What happened?')).toBe('What happened?');
        expect(cleanQuestion('- What happened?')).toBe('What happened?');
      });

      it('should remove quotes', () => {
        expect(cleanQuestion('"What happened?"')).toBe('What happened?');
      });
    });

    describe('isValidQuestion', () => {
      it('should accept valid questions', () => {
        expect(isValidQuestion('What happened today?')).toBe(true);
        expect(isValidQuestion('How did that make you feel?')).toBe(true);
      });

      it('should reject too short', () => {
        expect(isValidQuestion('Hi?')).toBe(false);
      });

      it('should reject null/empty', () => {
        expect(isValidQuestion('')).toBe(false);
        expect(isValidQuestion(null)).toBe(false);
      });
    });
  });

  describe('QueueManager', () => {
    describe('shouldContinueQueue', () => {
      it('should return true for "1"', () => {
        expect(shouldContinueQueue('1')).toBe(true);
      });

      it('should return false for "0"', () => {
        expect(shouldContinueQueue('0')).toBe(false);
      });

      it('should handle empty/null', () => {
        expect(shouldContinueQueue('')).toBe(false);
        expect(shouldContinueQueue(null)).toBe(false);
      });
    });

    describe('getNextUnsent', () => {
      it('should return first unsent item', () => {
        const queue = [
          MessageQueue.create({ chatId: 'c1', queuedMessage: 'Q1' }).withMessageId('m1'),
          MessageQueue.create({ chatId: 'c1', queuedMessage: 'Q2' }),
        ];
        
        const next = getNextUnsent(queue);
        expect(next.queuedMessage).toBe('Q2');
      });

      it('should return null for empty queue', () => {
        expect(getNextUnsent([])).toBeNull();
      });
    });

    describe('formatQuestion', () => {
      it('should add prefix emoji', () => {
        const formatted = formatQuestion('What happened?', '📖');
        expect(formatted).toBe('📖 What happened?');
      });

      it('should clean leading punctuation', () => {
        const formatted = formatQuestion('- What happened?');
        expect(formatted).toBe('⏩ What happened?');
      });
    });

    describe('buildDefaultChoices', () => {
      it('should return default keyboard', () => {
        const choices = buildDefaultChoices();
        expect(choices).toEqual([['🎲 Change Subject', '❌ Cancel']]);
      });
    });

    describe('createQueueFromQuestions', () => {
      it('should create queue items', () => {
        const queue = createQueueFromQuestions('chat-1', ['Q1?', 'Q2?']);
        
        expect(queue).toHaveLength(2);
        expect(queue[0].queuedMessage).toBe('Q1?');
        expect(queue[1].queuedMessage).toBe('Q2?');
      });
    });

    describe('getUnsentCount', () => {
      it('should count unsent items', () => {
        const queue = [
          MessageQueue.create({ chatId: 'c1', queuedMessage: 'Q1' }).withMessageId('m1'),
          MessageQueue.create({ chatId: 'c1', queuedMessage: 'Q2' }),
          MessageQueue.create({ chatId: 'c1', queuedMessage: 'Q3' }),
        ];
        
        expect(getUnsentCount(queue)).toBe(2);
      });
    });
  });

  describe('PromptBuilder', () => {
    describe('buildBiographerPrompt', () => {
      it('should build biographer prompt', () => {
        const prompt = buildBiographerPrompt('history', 'entry');
        
        expect(prompt).toHaveLength(2);
        expect(prompt[0].role).toBe('system');
        expect(prompt[1].role).toBe('user');
        expect(prompt[0].content).toContain('biographer');
      });
    });

    describe('buildAutobiographerPrompt', () => {
      it('should build autobiographer prompt', () => {
        const prompt = buildAutobiographerPrompt('history');
        
        expect(prompt).toHaveLength(2);
        expect(prompt[0].role).toBe('system');
        expect(prompt[0].content).toContain('journaling');
      });

      it('should work without history', () => {
        const prompt = buildAutobiographerPrompt('');
        expect(prompt).toHaveLength(2);
      });
    });

    describe('buildMultipleChoicePrompt', () => {
      it('should build multiple choice prompt', () => {
        const prompt = buildMultipleChoicePrompt('history', 'comment', 'question?');
        
        expect(prompt).toHaveLength(2);
        expect(prompt[0].content).toContain('JSON array');
        expect(prompt[1].content).toContain('question?');
      });
    });

    describe('buildEvaluateResponsePrompt', () => {
      it('should build evaluate response prompt', () => {
        const prompt = buildEvaluateResponsePrompt('history', 'response', ['Q1?', 'Q2?']);
        
        expect(prompt).toHaveLength(2);
        expect(prompt[0].content).toContain('1');
        expect(prompt[0].content).toContain('0');
        expect(prompt[1].content).toContain('Q1?');
      });
    });
  });
});
