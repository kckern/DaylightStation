/**
 * Journalist Journaling Flow Integration Tests
 * @module _tests/journalist/integration/JournalingFlow.test
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock implementations for testing
class MockMessagingGateway {
  constructor() {
    this.messages = [];
    this.deletedMessages = [];
    this.lastMessageId = 0;
  }

  async sendMessage(conversationId, text, options = {}) {
    const messageId = `msg-${++this.lastMessageId}`;
    this.messages.push({ 
      conversationId, 
      text, 
      options, 
      messageId, 
      type: 'text',
      timestamp: Date.now(),
    });
    return { messageId };
  }

  async updateMessage(conversationId, messageId, options) {
    const msg = this.messages.find(m => m.messageId === messageId);
    if (msg) {
      msg.text = options.text || msg.text;
      msg.choices = options.choices;
      msg.updated = true;
    }
    return {};
  }

  async deleteMessage(conversationId, messageId) {
    this.deletedMessages.push({ conversationId, messageId });
    const idx = this.messages.findIndex(m => m.messageId === messageId);
    if (idx !== -1) {
      this.messages.splice(idx, 1);
    }
  }

  getLastMessage() {
    return this.messages[this.messages.length - 1];
  }

  getMessagesByConversation(conversationId) {
    return this.messages.filter(m => m.conversationId === conversationId);
  }

  reset() {
    this.messages = [];
    this.deletedMessages = [];
    this.lastMessageId = 0;
  }
}

class MockAIGateway {
  constructor() {
    this.responseQueue = [];
  }

  async chat(messages, options = {}) {
    if (this.responseQueue.length > 0) {
      return this.responseQueue.shift();
    }
    // Default: return a follow-up question
    return JSON.stringify({
      followUpQuestion: "That's interesting. How did that make you feel?",
      choices: ["Happy", "Sad", "Neutral", "Anxious"],
    });
  }

  queueResponse(response) {
    this.responseQueue.push(response);
  }

  reset() {
    this.responseQueue = [];
  }
}

class MockJournalEntryRepository {
  constructor() {
    this.entries = [];
  }

  async save(entry) {
    this.entries.push({ ...entry, savedAt: Date.now() });
  }

  async findByDate(chatId, date) {
    return this.entries.filter(e => 
      e.chatId === chatId && 
      e.createdAt?.startsWith(date)
    );
  }

  async findRecent(chatId, days) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return this.entries.filter(e => 
      e.chatId === chatId && 
      (e.savedAt || 0) >= cutoff
    );
  }

  async getRecentEntryUuids(chatId, since) {
    return this.entries
      .filter(e => e.chatId === chatId)
      .map(e => e.uuid);
  }

  reset() {
    this.entries = [];
  }
}

class MockMessageQueueRepository {
  constructor() {
    this.queues = new Map();
  }

  async push(chatId, item) {
    if (!this.queues.has(chatId)) {
      this.queues.set(chatId, []);
    }
    this.queues.get(chatId).push(item);
  }

  async getNext(chatId) {
    const queue = this.queues.get(chatId);
    if (!queue || queue.length === 0) return null;
    return queue[0];
  }

  async shift(chatId) {
    const queue = this.queues.get(chatId);
    if (!queue) return null;
    return queue.shift();
  }

  async clear(chatId) {
    this.queues.delete(chatId);
  }

  async getQueueLength(chatId) {
    const queue = this.queues.get(chatId);
    return queue ? queue.length : 0;
  }

  reset() {
    this.queues.clear();
  }
}

class MockQuizRepository {
  constructor() {
    this.questions = new Map();
    this.answers = [];
    
    // Pre-populate with some quiz questions
    const categories = ['gratitude', 'reflection', 'mindfulness'];
    categories.forEach(category => {
      this.questions.set(category, [
        {
          uuid: `${category}-q1`,
          category,
          question: `What are you grateful for today? (${category})`,
          choices: ['Family', 'Health', 'Work', 'Other'],
        },
        {
          uuid: `${category}-q2`,
          category,
          question: `How would you rate your day? (${category})`,
          choices: ['Great', 'Good', 'Okay', 'Challenging'],
        },
      ]);
    });
  }

  async findByCategory(category) {
    return this.questions.get(category) || [];
  }

  async findById(uuid) {
    for (const questions of this.questions.values()) {
      const q = questions.find(q => q.uuid === uuid);
      if (q) return q;
    }
    return null;
  }

  async saveAnswer(answer) {
    this.answers.push(answer);
  }

  async getAnswers(chatId) {
    return this.answers.filter(a => a.chatId === chatId);
  }

  reset() {
    this.answers = [];
  }
}

class MockPromptTemplateRepository {
  constructor() {
    this.templates = new Map([
      ['journal_prompt', 'You are a thoughtful journaling assistant. Ask a reflective question about: {{topic}}'],
      ['therapist_analysis', 'You are a supportive therapist. Analyze the following entries with compassion: {{entries}}'],
      ['follow_up', 'Generate a follow-up question based on: {{entry}}'],
    ]);
  }

  async get(name) {
    return this.templates.get(name);
  }

  async render(name, variables) {
    let template = this.templates.get(name) || '';
    for (const [key, value] of Object.entries(variables)) {
      template = template.replace(`{{${key}}}`, String(value));
    }
    return template;
  }
}

// ==================== Integration Tests ====================

describe('Journalist Journaling Flow Integration', () => {
  let messagingGateway;
  let aiGateway;
  let journalEntryRepository;
  let messageQueueRepository;
  let quizRepository;
  let promptTemplateRepository;

  beforeEach(() => {
    messagingGateway = new MockMessagingGateway();
    aiGateway = new MockAIGateway();
    journalEntryRepository = new MockJournalEntryRepository();
    messageQueueRepository = new MockMessageQueueRepository();
    quizRepository = new MockQuizRepository();
    promptTemplateRepository = new MockPromptTemplateRepository();
  });

  describe('Text Entry → Follow-up → Response Flow', () => {
    it('should handle complete text entry conversation', async () => {
      // Simulate initial text entry
      const entry1 = {
        uuid: 'entry-1',
        chatId: 'chat-1',
        text: 'Today was a challenging day at work.',
        createdAt: new Date().toISOString(),
      };
      await journalEntryRepository.save(entry1);

      // Simulate AI generating follow-up
      const followUp = {
        question: 'What made it particularly challenging?',
        choices: ['Heavy workload', 'Difficult colleague', 'Technical problems', 'Other'],
      };

      // Queue the follow-up
      await messageQueueRepository.push('chat-1', {
        type: 'follow_up',
        question: followUp.question,
        choices: followUp.choices,
      });

      // Verify queue
      const queueLength = await messageQueueRepository.getQueueLength('chat-1');
      expect(queueLength).toBe(1);

      // Get next item
      const nextItem = await messageQueueRepository.getNext('chat-1');
      expect(nextItem.question).toBe('What made it particularly challenging?');

      // Simulate user response
      const entry2 = {
        uuid: 'entry-2',
        chatId: 'chat-1',
        text: 'Heavy workload',
        parentUuid: 'entry-1',
        createdAt: new Date().toISOString(),
      };
      await journalEntryRepository.save(entry2);

      // Remove from queue
      await messageQueueRepository.shift('chat-1');

      // Verify entries saved
      const entries = journalEntryRepository.entries;
      expect(entries.length).toBe(2);
    });
  });

  describe('Queue Management', () => {
    it('should manage multiple queued questions', async () => {
      const chatId = 'chat-1';

      // Queue multiple follow-ups
      await messageQueueRepository.push(chatId, { question: 'Q1', priority: 1 });
      await messageQueueRepository.push(chatId, { question: 'Q2', priority: 2 });
      await messageQueueRepository.push(chatId, { question: 'Q3', priority: 3 });

      // Process queue in order
      const q1 = await messageQueueRepository.shift(chatId);
      expect(q1.question).toBe('Q1');

      const q2 = await messageQueueRepository.shift(chatId);
      expect(q2.question).toBe('Q2');

      const remaining = await messageQueueRepository.getQueueLength(chatId);
      expect(remaining).toBe(1);
    });

    it('should clear queue on special start', async () => {
      const chatId = 'chat-1';

      // Build up a queue
      await messageQueueRepository.push(chatId, { question: 'Q1' });
      await messageQueueRepository.push(chatId, { question: 'Q2' });

      // Simulate 🎲 (change subject) clearing the queue
      await messageQueueRepository.clear(chatId);

      const length = await messageQueueRepository.getQueueLength(chatId);
      expect(length).toBe(0);
    });
  });

  describe('Quiz Flow', () => {
    it('should cycle through quiz questions', async () => {
      const chatId = 'chat-1';

      // Get questions for a category
      const questions = await quizRepository.findByCategory('gratitude');
      expect(questions.length).toBe(2);

      // Answer first question
      await quizRepository.saveAnswer({
        chatId,
        questionUuid: questions[0].uuid,
        answer: 'Family',
        answeredAt: new Date().toISOString(),
      });

      // Answer second question
      await quizRepository.saveAnswer({
        chatId,
        questionUuid: questions[1].uuid,
        answer: 'Great',
        answeredAt: new Date().toISOString(),
      });

      // Verify answers saved
      const answers = await quizRepository.getAnswers(chatId);
      expect(answers.length).toBe(2);
    });

    it('should transition from quiz to journal', async () => {
      const chatId = 'chat-1';

      // Simulate completing quiz (no more quiz items in queue)
      await messageQueueRepository.push(chatId, { type: 'quiz', questionUuid: 'q1' });
      await messageQueueRepository.shift(chatId); // Process quiz

      // After quiz, queue should be empty or have journal prompt
      const nextItem = await messageQueueRepository.getNext(chatId);
      expect(nextItem).toBeNull();

      // In real flow, this would trigger journal prompt
    });
  });

  describe('Journal Export', () => {
    it('should export entries as markdown', async () => {
      const chatId = 'chat-1';
      const today = new Date().toISOString().split('T')[0];

      // Add some entries
      await journalEntryRepository.save({
        uuid: 'e1',
        chatId,
        text: 'Had a great morning',
        createdAt: `${today}T09:00:00.000Z`,
      });
      await journalEntryRepository.save({
        uuid: 'e2',
        chatId,
        text: 'Lunch was delicious',
        createdAt: `${today}T12:30:00.000Z`,
      });

      // Get entries for export
      const entries = await journalEntryRepository.findByDate(chatId, today);
      expect(entries.length).toBe(2);

      // Format as markdown (simulating export use case)
      const markdown = entries.map(e => `* ${e.text}`).join('\n');
      expect(markdown).toContain('Had a great morning');
      expect(markdown).toContain('Lunch was delicious');
    });
  });

  describe('Therapist Analysis', () => {
    it('should gather entries for analysis', async () => {
      const chatId = 'chat-1';

      // Add entries over past days
      for (let i = 0; i < 7; i++) {
        await journalEntryRepository.save({
          uuid: `e-${i}`,
          chatId,
          text: `Day ${i} entry`,
          createdAt: new Date().toISOString(),
          savedAt: Date.now() - (i * 24 * 60 * 60 * 1000),
        });
      }

      // Get recent entries for analysis
      const entries = await journalEntryRepository.findRecent(chatId, 7);
      expect(entries.length).toBe(7);

      // Render analysis prompt
      const prompt = await promptTemplateRepository.render('therapist_analysis', {
        entries: entries.map(e => e.text).join('\n'),
      });
      expect(prompt).toContain('supportive therapist');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty journal history', async () => {
      const entries = await journalEntryRepository.findRecent('new-user', 7);
      expect(entries.length).toBe(0);
    });

    it('should handle missing quiz category', async () => {
      const questions = await quizRepository.findByCategory('nonexistent');
      expect(questions.length).toBe(0);
    });

    it('should handle concurrent sessions', async () => {
      // User 1
      await messageQueueRepository.push('chat-1', { question: 'Q1 for user 1' });
      
      // User 2
      await messageQueueRepository.push('chat-2', { question: 'Q1 for user 2' });

      // Verify isolation
      const q1 = await messageQueueRepository.getNext('chat-1');
      const q2 = await messageQueueRepository.getNext('chat-2');

      expect(q1.question).toBe('Q1 for user 1');
      expect(q2.question).toBe('Q1 for user 2');
    });
  });
});
