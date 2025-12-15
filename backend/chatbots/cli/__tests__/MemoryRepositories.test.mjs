/**
 * Memory Repositories Tests
 * @module cli/__tests__/MemoryRepositories.test
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import {
  MemoryNutrilogRepository,
  MemoryNutrilistRepository,
  MemoryConversationStateStore,
  MemoryJournalEntryRepository,
  MemoryMessageQueueRepository,
} from '../mocks/MemoryRepositories.mjs';

describe('MemoryNutrilogRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new MemoryNutrilogRepository();
  });

  describe('save and findByUuid', () => {
    it('should save and retrieve a log', async () => {
      const log = {
        chatId: 'chat-1',
        items: [{ name: 'Apple', calories: 95 }],
        status: 'pending',
      };

      const saved = await repo.save(log);
      expect(saved.uuid).toBeDefined();

      const found = await repo.findByUuid(saved.uuid);
      expect(found).toBeDefined();
      expect(found.items[0].name).toBe('Apple');
    });

    it('should return null for unknown uuid', async () => {
      const found = await repo.findByUuid('unknown');
      expect(found).toBeNull();
    });
  });

  describe('findByStatus', () => {
    it('should find logs by status', async () => {
      await repo.save({ chatId: 'chat-1', status: 'pending', items: [] });
      await repo.save({ chatId: 'chat-1', status: 'accepted', items: [] });
      await repo.save({ chatId: 'chat-1', status: 'pending', items: [] });

      const pending = await repo.findByStatus('chat-1', 'pending');
      expect(pending.length).toBe(2);

      const accepted = await repo.findByStatus('chat-1', 'accepted');
      expect(accepted.length).toBe(1);
    });
  });

  describe('findPending', () => {
    it('should find pending logs for user', async () => {
      await repo.save({ userId: 'user-1', status: 'pending', items: [] });
      await repo.save({ userId: 'user-1', status: 'accepted', items: [] });
      await repo.save({ userId: 'user-2', status: 'pending', items: [] });

      const pending = await repo.findPending('user-1');
      expect(pending.length).toBe(1);
    });
  });

  describe('getDailySummary', () => {
    it('should calculate daily summary', async () => {
      await repo.save({
        userId: 'user-1',
        status: 'accepted',
        items: [
          { name: 'Apple', calories: 95, protein: 0, carbs: 25, fat: 0, grams: 182, color: 'green' },
          { name: 'Chicken', calories: 250, protein: 46, carbs: 0, fat: 5, grams: 150, color: 'green' },
        ],
      });

      const summary = await repo.getDailySummary('user-1', '2024-12-14');
      
      expect(summary.logCount).toBe(1);
      expect(summary.itemCount).toBe(2);
      expect(summary.totals.calories).toBe(345);
      expect(summary.totals.protein).toBe(46);
      expect(summary.colorCounts.green).toBe(2);
    });
  });

  describe('updateStatus', () => {
    it('should update log status', async () => {
      const saved = await repo.save({ status: 'pending', items: [] });
      
      await repo.updateStatus(saved.uuid, 'accepted');
      
      const found = await repo.findByUuid(saved.uuid);
      expect(found.status).toBe('accepted');
    });
  });

  describe('delete', () => {
    it('should delete a log', async () => {
      const saved = await repo.save({ items: [] });
      
      const deleted = await repo.delete(saved.uuid);
      expect(deleted).toBe(true);
      
      const found = await repo.findByUuid(saved.uuid);
      expect(found).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all logs', async () => {
      await repo.save({ items: [] });
      await repo.save({ items: [] });
      
      repo.clear();
      
      expect(repo.size).toBe(0);
    });
  });
});

describe('MemoryNutrilistRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new MemoryNutrilistRepository();
  });

  describe('saveMany', () => {
    it('should save multiple items', async () => {
      const items = [
        { userId: 'user-1', name: 'Apple', calories: 95 },
        { userId: 'user-1', name: 'Banana', calories: 105 },
      ];

      const saved = await repo.saveMany(items);
      
      expect(saved.length).toBe(2);
      expect(saved[0].id).toBeDefined();
      expect(repo.size).toBe(2);
    });
  });

  describe('findByDate', () => {
    it('should find items by date', async () => {
      await repo.saveMany([
        { userId: 'user-1', date: '2024-12-14', name: 'Apple' },
        { userId: 'user-1', date: '2024-12-15', name: 'Banana' },
      ]);

      const items = await repo.findByDate('user-1', '2024-12-14');
      expect(items.length).toBe(1);
      expect(items[0].name).toBe('Apple');
    });
  });

  describe('getDailyTotals', () => {
    it('should calculate daily totals', async () => {
      await repo.saveMany([
        { userId: 'user-1', date: '2024-12-14', calories: 100, protein: 10, carbs: 20, fat: 5, grams: 100 },
        { userId: 'user-1', date: '2024-12-14', calories: 200, protein: 20, carbs: 30, fat: 10, grams: 150 },
      ]);

      const totals = await repo.getDailyTotals('user-1', '2024-12-14');
      
      expect(totals.calories).toBe(300);
      expect(totals.protein).toBe(30);
      expect(totals.itemCount).toBe(2);
    });
  });
});

describe('MemoryConversationStateStore', () => {
  let store;

  beforeEach(() => {
    store = new MemoryConversationStateStore();
  });

  describe('set and get', () => {
    it('should store and retrieve state', async () => {
      await store.set('conv-1', { flow: 'confirmation', logId: '123' });
      
      const state = await store.get('conv-1');
      
      expect(state.flow).toBe('confirmation');
      expect(state.logId).toBe('123');
    });

    it('should return null for unknown conversation', async () => {
      const state = await store.get('unknown');
      expect(state).toBeNull();
    });
  });

  describe('has', () => {
    it('should check if state exists', async () => {
      await store.set('conv-1', { flow: 'idle' });
      
      expect(await store.has('conv-1')).toBe(true);
      expect(await store.has('conv-2')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete state', async () => {
      await store.set('conv-1', { flow: 'idle' });
      
      await store.delete('conv-1');
      
      expect(await store.has('conv-1')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all states', async () => {
      await store.set('conv-1', { flow: 'idle' });
      await store.set('conv-2', { flow: 'idle' });
      
      store.clear();
      
      expect(store.size).toBe(0);
    });
  });
});

describe('MemoryJournalEntryRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new MemoryJournalEntryRepository();
  });

  describe('save', () => {
    it('should save an entry', async () => {
      const entry = { userId: 'user-1', type: 'text', content: 'Today was great' };
      
      const saved = await repo.save(entry);
      
      expect(saved.id).toBeDefined();
      expect(saved.createdAt).toBeDefined();
    });
  });

  describe('findByDate', () => {
    it('should find entries by date', async () => {
      await repo.save({ userId: 'user-1', date: '2024-12-14', content: 'Entry 1' });
      await repo.save({ userId: 'user-1', date: '2024-12-15', content: 'Entry 2' });

      const entries = await repo.findByDate('user-1', '2024-12-14');
      
      expect(entries.length).toBe(1);
      expect(entries[0].content).toBe('Entry 1');
    });
  });

  describe('getRecent', () => {
    it('should get recent entries', async () => {
      for (let i = 0; i < 15; i++) {
        await repo.save({ userId: 'user-1', content: `Entry ${i}` });
      }

      const recent = await repo.getRecent('user-1', 5);
      
      expect(recent.length).toBe(5);
    });
  });
});

describe('MemoryMessageQueueRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new MemoryMessageQueueRepository();
  });

  describe('push and pop', () => {
    it('should push and pop messages', async () => {
      await repo.push('conv-1', { text: 'Message 1' });
      await repo.push('conv-1', { text: 'Message 2' });
      
      const msg1 = await repo.pop('conv-1');
      expect(msg1.text).toBe('Message 1');
      
      const msg2 = await repo.pop('conv-1');
      expect(msg2.text).toBe('Message 2');
      
      const msg3 = await repo.pop('conv-1');
      expect(msg3).toBeNull();
    });
  });

  describe('peek', () => {
    it('should peek without removing', async () => {
      await repo.push('conv-1', { text: 'Message 1' });
      
      const peeked = await repo.peek('conv-1');
      expect(peeked.text).toBe('Message 1');
      
      const size = await repo.size('conv-1');
      expect(size).toBe(1);
    });
  });

  describe('size', () => {
    it('should return queue size', async () => {
      await repo.push('conv-1', { text: 'M1' });
      await repo.push('conv-1', { text: 'M2' });
      await repo.push('conv-1', { text: 'M3' });
      
      const size = await repo.size('conv-1');
      expect(size).toBe(3);
    });

    it('should return 0 for unknown conversation', async () => {
      const size = await repo.size('unknown');
      expect(size).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear queue for conversation', async () => {
      await repo.push('conv-1', { text: 'M1' });
      await repo.push('conv-2', { text: 'M2' });
      
      await repo.clear('conv-1');
      
      expect(await repo.size('conv-1')).toBe(0);
      expect(await repo.size('conv-2')).toBe(1);
    });
  });
});
