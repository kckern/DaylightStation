/**
 * Journalist Domain Tests
 * @group journalist
 * @group Phase4
 */

import {
  PromptType,
  isValidPromptType,
  promptTypeDescription,
  ALL_PROMPT_TYPES,
} from '../../bots/journalist/domain/value-objects/PromptType.mjs';

import {
  EntrySource,
  isValidEntrySource,
  entrySourceEmoji,
  ALL_ENTRY_SOURCES,
} from '../../bots/journalist/domain/value-objects/EntrySource.mjs';

import {
  QuizCategory,
  isValidQuizCategory,
  quizCategoryEmoji,
  ALL_QUIZ_CATEGORIES,
} from '../../bots/journalist/domain/value-objects/QuizCategory.mjs';

import { ConversationMessage } from '../../bots/journalist/domain/entities/ConversationMessage.mjs';
import { MessageQueue } from '../../bots/journalist/domain/entities/MessageQueue.mjs';
import { JournalEntry } from '../../bots/journalist/domain/entities/JournalEntry.mjs';
import { QuizQuestion } from '../../bots/journalist/domain/entities/QuizQuestion.mjs';
import { QuizAnswer } from '../../bots/journalist/domain/entities/QuizAnswer.mjs';

describe('Journalist Domain', () => {
  describe('Value Objects', () => {
    describe('PromptType', () => {
      it('should have all expected types', () => {
        expect(PromptType.BIOGRAPHER).toBe('biographer');
        expect(PromptType.AUTOBIOGRAPHER).toBe('autobiographer');
        expect(PromptType.MULTIPLE_CHOICE).toBe('multiple_choice');
        expect(PromptType.EVALUATE_RESPONSE).toBe('evaluate_response');
        expect(PromptType.THERAPIST_ANALYSIS).toBe('therapist_analysis');
      });

      it('should validate prompt types', () => {
        expect(isValidPromptType('biographer')).toBe(true);
        expect(isValidPromptType('invalid')).toBe(false);
      });

      it('should return descriptions', () => {
        expect(promptTypeDescription(PromptType.BIOGRAPHER)).toContain('follow-up');
      });

      it('should export all types', () => {
        expect(ALL_PROMPT_TYPES).toHaveLength(5);
      });
    });

    describe('EntrySource', () => {
      it('should have all expected sources', () => {
        expect(EntrySource.TEXT).toBe('text');
        expect(EntrySource.VOICE).toBe('voice');
        expect(EntrySource.CALLBACK).toBe('callback');
        expect(EntrySource.SYSTEM).toBe('system');
      });

      it('should validate entry sources', () => {
        expect(isValidEntrySource('text')).toBe(true);
        expect(isValidEntrySource('invalid')).toBe(false);
      });

      it('should return emojis', () => {
        expect(entrySourceEmoji(EntrySource.TEXT)).toBe('📝');
        expect(entrySourceEmoji(EntrySource.VOICE)).toBe('🎤');
      });

      it('should export all sources', () => {
        expect(ALL_ENTRY_SOURCES).toHaveLength(4);
      });
    });

    describe('QuizCategory', () => {
      it('should have all expected categories', () => {
        expect(QuizCategory.MOOD).toBe('mood');
        expect(QuizCategory.GOALS).toBe('goals');
        expect(QuizCategory.GRATITUDE).toBe('gratitude');
        expect(QuizCategory.REFLECTION).toBe('reflection');
        expect(QuizCategory.HABITS).toBe('habits');
      });

      it('should validate quiz categories', () => {
        expect(isValidQuizCategory('mood')).toBe(true);
        expect(isValidQuizCategory('invalid')).toBe(false);
      });

      it('should return emojis', () => {
        expect(quizCategoryEmoji(QuizCategory.MOOD)).toBe('😊');
        expect(quizCategoryEmoji(QuizCategory.GOALS)).toBe('🎯');
      });

      it('should export all categories', () => {
        expect(ALL_QUIZ_CATEGORIES).toHaveLength(5);
      });
    });
  });

  describe('Entities', () => {
    describe('ConversationMessage', () => {
      const validProps = {
        messageId: 'msg-123',
        chatId: 'chat-456',
        senderId: 'user-789',
        senderName: 'Test User',
        text: 'Hello world',
      };

      it('should create a valid message', () => {
        const msg = new ConversationMessage(validProps);
        expect(msg.messageId).toBe('msg-123');
        expect(msg.chatId).toBe('chat-456');
        expect(msg.text).toBe('Hello world');
      });

      it('should detect bot messages', () => {
        const userMsg = new ConversationMessage(validProps);
        expect(userMsg.isFromBot('Journalist')).toBe(false);

        const botMsg = new ConversationMessage({
          ...validProps,
          senderName: 'Journalist',
        });
        expect(botMsg.isFromBot('Journalist')).toBe(true);
      });

      it('should create bot message via factory', () => {
        const msg = ConversationMessage.createBotMessage({
          chatId: 'chat-1',
          text: 'Bot response',
        });
        expect(msg.senderName).toBe('Journalist');
        expect(msg.isFromBot()).toBe(true);
      });

      it('should serialize to JSON', () => {
        const msg = new ConversationMessage(validProps);
        const json = msg.toJSON();
        expect(json.messageId).toBe('msg-123');
        expect(json.text).toBe('Hello world');
      });

      it('should require messageId', () => {
        expect(() => new ConversationMessage({ ...validProps, messageId: null }))
          .toThrow('messageId');
      });
    });

    describe('MessageQueue', () => {
      const validProps = {
        chatId: 'chat-123',
        queuedMessage: 'What happened next?',
      };

      it('should create a valid queue item', () => {
        const item = new MessageQueue(validProps);
        expect(item.chatId).toBe('chat-123');
        expect(item.queuedMessage).toBe('What happened next?');
        expect(item.uuid).toBeDefined();
      });

      it('should track sent status', () => {
        const item = new MessageQueue(validProps);
        expect(item.isSent()).toBe(false);

        const sent = item.withMessageId('msg-456');
        expect(sent.isSent()).toBe(true);
        expect(sent.messageId).toBe('msg-456');
      });

      it('should add choices', () => {
        const item = new MessageQueue(validProps);
        expect(item.hasChoices()).toBe(false);

        const withChoices = item.withChoices([['Yes', 'No']]);
        expect(withChoices.hasChoices()).toBe(true);
      });

      it('should serialize to JSON', () => {
        const item = new MessageQueue(validProps);
        const json = item.toJSON();
        expect(json.chatId).toBe('chat-123');
        expect(json.queuedMessage).toBe('What happened next?');
      });
    });

    describe('JournalEntry', () => {
      const validProps = {
        chatId: 'chat-123',
        date: '2024-12-13',
        text: 'Today was a good day.',
      };

      it('should create a valid entry', () => {
        const entry = JournalEntry.create(validProps);
        expect(entry.chatId).toBe('chat-123');
        expect(entry.date).toBe('2024-12-13');
        expect(entry.text).toBe('Today was a good day.');
      });

      it('should default to text source', () => {
        const entry = JournalEntry.create(validProps);
        expect(entry.source).toBe('text');
      });

      it('should calculate word count', () => {
        const entry = JournalEntry.create(validProps);
        expect(entry.wordCount).toBe(5);
      });

      it('should add analysis', () => {
        const entry = JournalEntry.create(validProps);
        expect(entry.hasAnalysis).toBe(false);

        const analyzed = entry.withAnalysis({
          themes: ['gratitude'],
          sentiment: 'positive',
          insights: [],
        });
        expect(analyzed.hasAnalysis).toBe(true);
      });

      it('should validate period', () => {
        expect(() => JournalEntry.create({ ...validProps, period: 'invalid' }))
          .toThrow('period');
      });
    });

    describe('QuizQuestion', () => {
      const validProps = {
        category: 'mood',
        question: 'How are you feeling today?',
        choices: ['Great', 'Good', 'Okay', 'Not great'],
      };

      it('should create a valid question', () => {
        const q = QuizQuestion.create(validProps);
        expect(q.category).toBe('mood');
        expect(q.question).toBe('How are you feeling today?');
        expect(q.choices).toHaveLength(4);
      });

      it('should track last asked', () => {
        const q = QuizQuestion.create(validProps);
        expect(q.hasBeenAsked).toBe(false);

        const asked = q.markAsked();
        expect(asked.hasBeenAsked).toBe(true);
        expect(asked.lastAsked).toBeDefined();
      });

      it('should require at least 2 choices', () => {
        expect(() => QuizQuestion.create({ ...validProps, choices: ['One'] }))
          .toThrow('choices');
      });

      it('should validate category', () => {
        expect(() => QuizQuestion.create({ ...validProps, category: 'invalid' }))
          .toThrow('category');
      });
    });

    describe('QuizAnswer', () => {
      const validProps = {
        questionUuid: 'q-123',
        chatId: 'chat-456',
        date: '2024-12-13',
        answer: 2,
      };

      it('should create a valid answer', () => {
        const a = QuizAnswer.create(validProps);
        expect(a.questionUuid).toBe('q-123');
        expect(a.answer).toBe(2);
      });

      it('should detect numeric vs text answer', () => {
        const numeric = QuizAnswer.create(validProps);
        expect(numeric.isNumericAnswer).toBe(true);

        const text = QuizAnswer.create({ ...validProps, answer: 'Custom response' });
        expect(text.isTextAnswer).toBe(true);
      });

      it('should require answer', () => {
        expect(() => QuizAnswer.create({ ...validProps, answer: undefined }))
          .toThrow('answer');
      });
    });
  });
});
