/**
 * Tests for InMemoryStateStore
 * @group Phase2
 */

import { InMemoryStateStore } from '../../infrastructure/persistence/InMemoryStateStore.mjs';
import { ConversationState } from '../../domain/entities/ConversationState.mjs';
import { ChatId } from '../../domain/value-objects/ChatId.mjs';
import { Timestamp } from '../../domain/value-objects/Timestamp.mjs';
import { isConversationStateStore } from '../../application/ports/IConversationStateStore.mjs';

describe('Phase2: InMemoryStateStore', () => {
  let store;
  let chatId;

  beforeEach(() => {
    store = new InMemoryStateStore();
    chatId = new ChatId('testbot', 'user123');
  });

  describe('interface compliance', () => {
    it('should implement IConversationStateStore', () => {
      expect(isConversationStateStore(store)).toBe(true);
    });
  });

  describe('get', () => {
    it('should return null when no state set', async () => {
      const state = await store.get(chatId);
      expect(state).toBeNull();
    });

    it('should return set state', async () => {
      const state = ConversationState.empty(chatId);
      await store.set(chatId, state);
      
      const retrieved = await store.get(chatId);
      expect(retrieved).not.toBeNull();
      expect(retrieved.chatId.equals(chatId)).toBe(true);
    });
  });

  describe('set', () => {
    it('should store state', async () => {
      const state = ConversationState.empty(chatId).with({ activeFlow: 'test_flow' });
      await store.set(chatId, state);
      
      const retrieved = await store.get(chatId);
      expect(retrieved.activeFlow).toBe('test_flow');
    });

    it('should overwrite existing state', async () => {
      const state1 = ConversationState.empty(chatId).with({ activeFlow: 'flow1' });
      const state2 = ConversationState.empty(chatId).with({ activeFlow: 'flow2' });
      
      await store.set(chatId, state1);
      await store.set(chatId, state2);
      
      const retrieved = await store.get(chatId);
      expect(retrieved.activeFlow).toBe('flow2');
    });
  });

  describe('update', () => {
    it('should update existing state', async () => {
      const state = ConversationState.empty(chatId);
      await store.set(chatId, state);
      
      const updated = await store.update(chatId, { activeFlow: 'new_flow' });
      
      expect(updated.activeFlow).toBe('new_flow');
    });

    it('should create state if none exists', async () => {
      const updated = await store.update(chatId, { activeFlow: 'new_flow' });
      
      expect(updated.activeFlow).toBe('new_flow');
      expect(updated.chatId.equals(chatId)).toBe(true);
    });

    it('should merge flowState', async () => {
      const state = ConversationState.empty(chatId)
        .updateFlowState({ step: 1, data: 'original' });
      await store.set(chatId, state);
      
      const updated = await store.update(chatId, { 
        flowState: { step: 2, extra: 'new' } 
      });
      
      expect(updated.flowState.step).toBe(2);
      expect(updated.flowState.data).toBe('original');
      expect(updated.flowState.extra).toBe('new');
    });
  });

  describe('clear', () => {
    it('should remove state', async () => {
      const state = ConversationState.empty(chatId);
      await store.set(chatId, state);
      await store.clear(chatId);
      
      const retrieved = await store.get(chatId);
      expect(retrieved).toBeNull();
    });

    it('should not throw if no state exists', async () => {
      await expect(store.clear(chatId)).resolves.not.toThrow();
    });
  });

  describe('clearFlow', () => {
    it('should clear state when flow matches', async () => {
      const state = ConversationState.empty(chatId).with({ activeFlow: 'target_flow' });
      await store.set(chatId, state);
      
      await store.clearFlow(chatId, 'target_flow');
      
      const retrieved = await store.get(chatId);
      expect(retrieved.activeFlow).toBeNull();
    });

    it('should not clear state when flow does not match', async () => {
      const state = ConversationState.empty(chatId).with({ activeFlow: 'different_flow' });
      await store.set(chatId, state);
      
      await store.clearFlow(chatId, 'target_flow');
      
      const retrieved = await store.get(chatId);
      expect(retrieved.activeFlow).toBe('different_flow');
    });

    it('should not throw if no state exists', async () => {
      await expect(store.clearFlow(chatId, 'any_flow')).resolves.not.toThrow();
    });
  });

  describe('TTL expiration', () => {
    it('should expire state after TTL', async () => {
      // Create state with explicit short expiration (1 second from now)
      const expiresAt = Timestamp.now().add(1000, 'ms');
      const state = new ConversationState({ conversationId: chatId, expiresAt });
      await store.set(chatId, state);
      
      // Advance time past expiration
      store.advanceTime(2000);
      
      const retrieved = await store.get(chatId);
      expect(retrieved).toBeNull();
    });

    it('should not expire state before TTL', async () => {
      const expiresAt = Timestamp.now().add(5000, 'ms');
      const state = new ConversationState({ conversationId: chatId, expiresAt });
      await store.set(chatId, state);
      
      store.advanceTime(1000);
      
      const retrieved = await store.get(chatId);
      expect(retrieved).not.toBeNull();
    });
  });

  describe('testing helpers', () => {
    it('setState should set directly', () => {
      const state = ConversationState.empty(chatId);
      store.setState(chatId, state);
      
      expect(store.has(chatId)).toBe(true);
    });

    it('advanceTime should affect getCurrentTime', () => {
      const before = store.getCurrentTime();
      store.advanceTime(1000);
      const after = store.getCurrentTime();
      
      expect(after - before).toBeGreaterThanOrEqual(1000);
    });

    it('resetTime should reset offset', () => {
      store.advanceTime(5000);
      store.resetTime();
      
      const now = Date.now();
      expect(Math.abs(store.getCurrentTime() - now)).toBeLessThan(100);
    });

    it('reset should clear all state', async () => {
      await store.set(chatId, ConversationState.empty(chatId));
      store.advanceTime(1000);
      
      store.reset();
      
      expect(store.size).toBe(0);
      expect(store.getCurrentTime() - Date.now()).toBeLessThan(100);
    });

    it('getAllStates should return map', async () => {
      const chatId2 = new ChatId('testbot', 'user456');
      await store.set(chatId, ConversationState.empty(chatId));
      await store.set(chatId2, ConversationState.empty(chatId2));
      
      const all = store.getAllStates();
      expect(all.size).toBe(2);
    });

    it('size should return count', async () => {
      expect(store.size).toBe(0);
      await store.set(chatId, ConversationState.empty(chatId));
      expect(store.size).toBe(1);
    });

    it('has should check existence', async () => {
      expect(store.has(chatId)).toBe(false);
      await store.set(chatId, ConversationState.empty(chatId));
      expect(store.has(chatId)).toBe(true);
    });
  });

  describe('chat isolation', () => {
    it('should isolate state between chats', async () => {
      const chatId2 = new ChatId('testbot', 'user456');
      
      await store.set(chatId, ConversationState.empty(chatId).with({ activeFlow: 'flow1' }));
      await store.set(chatId2, ConversationState.empty(chatId2).with({ activeFlow: 'flow2' }));
      
      const state1 = await store.get(chatId);
      const state2 = await store.get(chatId2);
      
      expect(state1.activeFlow).toBe('flow1');
      expect(state2.activeFlow).toBe('flow2');
    });
  });
});
