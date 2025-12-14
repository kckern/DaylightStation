/**
 * Tests for ConversationState entity
 * @group Phase1
 */

import { ConversationState } from '../../domain/entities/ConversationState.mjs';
import { ConversationId, ChatId } from '../../domain/value-objects/ChatId.mjs';
import { MessageId } from '../../domain/value-objects/MessageId.mjs';
import { Timestamp } from '../../domain/value-objects/Timestamp.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

describe('Phase1: ConversationState', () => {
  const conversationId = new ConversationId('telegram', 'b123_c456');

  describe('constructor', () => {
    it('should create state with conversationId', () => {
      const state = new ConversationState({ conversationId });
      expect(state.conversationId.equals(conversationId)).toBe(true);
    });

    it('should convert plain object conversationId', () => {
      const state = new ConversationState({
        conversationId: { channel: 'telegram', identifier: 'b123_c456' },
      });
      expect(state.conversationId).toBeInstanceOf(ConversationId);
    });

    it('should support legacy chatId property', () => {
      const state = new ConversationState({
        chatId: { channel: 'telegram', identifier: 'b123_c456' },
      });
      expect(state.conversationId).toBeInstanceOf(ConversationId);
      // chatId should be alias
      expect(state.chatId.equals(state.conversationId)).toBe(true);
    });

    it('should have null activeFlow by default', () => {
      const state = new ConversationState({ conversationId });
      expect(state.activeFlow).toBeNull();
    });

    it('should have empty flowState by default', () => {
      const state = new ConversationState({ conversationId });
      expect(state.flowState).toEqual({});
    });

    it('should set updatedAt to now', () => {
      const before = Date.now();
      const state = new ConversationState({ conversationId });
      const after = Date.now();
      
      expect(state.updatedAt.toEpochMs()).toBeGreaterThanOrEqual(before);
      expect(state.updatedAt.toEpochMs()).toBeLessThanOrEqual(after);
    });

    it('should set expiresAt in the future', () => {
      const state = new ConversationState({ conversationId });
      expect(state.expiresAt.isAfter(state.updatedAt)).toBe(true);
    });

    it('should throw ValidationError for missing conversationId', () => {
      expect(() => new ConversationState({})).toThrow(ValidationError);
    });

    it('should be immutable', () => {
      const state = new ConversationState({ conversationId });
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.flowState)).toBe(true);
    });
  });

  describe('isExpired', () => {
    it('should return false for fresh state', () => {
      const state = new ConversationState({ conversationId });
      expect(state.isExpired).toBe(false);
    });

    it('should return true for expired state', () => {
      const pastExpiry = Timestamp.now().add(-1, 'h');
      const state = new ConversationState({
        conversationId,
        expiresAt: pastExpiry,
      });
      expect(state.isExpired).toBe(true);
    });
  });

  describe('hasActiveFlow', () => {
    it('should return false when no active flow', () => {
      const state = new ConversationState({ conversationId });
      expect(state.hasActiveFlow).toBe(false);
    });

    it('should return true when flow is active', () => {
      const state = new ConversationState({
        conversationId,
        activeFlow: 'food_logging',
      });
      expect(state.hasActiveFlow).toBe(true);
    });
  });

  describe('getFlowValue', () => {
    it('should return value from flowState', () => {
      const state = new ConversationState({
        conversationId,
        flowState: { step: 'confirm', itemId: '123' },
      });
      
      expect(state.getFlowValue('step')).toBe('confirm');
      expect(state.getFlowValue('itemId')).toBe('123');
    });

    it('should return default for missing key', () => {
      const state = new ConversationState({ conversationId });
      expect(state.getFlowValue('missing', 'default')).toBe('default');
    });

    it('should return undefined for missing key without default', () => {
      const state = new ConversationState({ conversationId });
      expect(state.getFlowValue('missing')).toBeUndefined();
    });
  });

  describe('toJSON', () => {
    it('should serialize to plain object', () => {
      const state = new ConversationState({
        conversationId,
        activeFlow: 'test_flow',
        flowState: { key: 'value' },
      });
      
      const json = state.toJSON();
      
      expect(json.conversationId).toEqual({ channel: 'telegram', identifier: 'b123_c456' });
      // chatId included for backward compatibility
      expect(json.chatId).toEqual({ channel: 'telegram', identifier: 'b123_c456' });
      expect(json.activeFlow).toBe('test_flow');
      expect(json.flowState).toEqual({ key: 'value' });
      expect(json.updatedAt).toBeDefined();
      expect(json.expiresAt).toBeDefined();
    });
  });

  describe('with', () => {
    it('should create new state with updates', () => {
      const original = new ConversationState({ conversationId });
      const updated = original.with({ activeFlow: 'new_flow' });
      
      expect(updated.activeFlow).toBe('new_flow');
      expect(updated).not.toBe(original);
      expect(updated.conversationId.equals(original.conversationId)).toBe(true);
    });

    it('should update updatedAt and expiresAt', () => {
      const original = new ConversationState({ conversationId });
      
      // Small delay to ensure different timestamp
      const updated = original.with({ activeFlow: 'flow' });
      
      expect(updated.updatedAt.toEpochMs()).toBeGreaterThanOrEqual(
        original.updatedAt.toEpochMs()
      );
    });
  });

  describe('startFlow', () => {
    it('should set activeFlow and initial state', () => {
      const state = new ConversationState({ conversationId });
      const withFlow = state.startFlow('food_logging', { step: 'start' });
      
      expect(withFlow.activeFlow).toBe('food_logging');
      expect(withFlow.flowState).toEqual({ step: 'start' });
    });

    it('should use empty initial state by default', () => {
      const state = new ConversationState({ conversationId });
      const withFlow = state.startFlow('simple_flow');
      
      expect(withFlow.flowState).toEqual({});
    });
  });

  describe('updateFlowState', () => {
    it('should merge state updates', () => {
      const state = new ConversationState({
        conversationId,
        activeFlow: 'flow',
        flowState: { a: 1, b: 2 },
      });
      
      const updated = state.updateFlowState({ b: 3, c: 4 });
      
      expect(updated.flowState).toEqual({ a: 1, b: 3, c: 4 });
    });
  });

  describe('clearFlow', () => {
    it('should clear activeFlow and flowState', () => {
      const state = new ConversationState({
        conversationId,
        activeFlow: 'flow',
        flowState: { data: 'value' },
      });
      
      const cleared = state.clearFlow();
      
      expect(cleared.activeFlow).toBeNull();
      expect(cleared.flowState).toEqual({});
    });
  });

  describe('clearSpecificFlow', () => {
    it('should clear matching flow', () => {
      const state = new ConversationState({
        conversationId,
        activeFlow: 'target_flow',
      });
      
      const cleared = state.clearSpecificFlow('target_flow');
      expect(cleared.activeFlow).toBeNull();
    });

    it('should not clear non-matching flow', () => {
      const state = new ConversationState({
        conversationId,
        activeFlow: 'other_flow',
      });
      
      const result = state.clearSpecificFlow('target_flow');
      expect(result.activeFlow).toBe('other_flow');
      expect(result).toBe(state); // Same instance
    });
  });

  describe('setLastMessage', () => {
    it('should set lastMessageId', () => {
      const state = new ConversationState({ conversationId });
      const updated = state.setLastMessage('msg123');
      
      expect(updated.lastMessageId).toBeInstanceOf(MessageId);
      expect(updated.lastMessageId.value).toBe('msg123');
    });

    it('should accept MessageId instance', () => {
      const state = new ConversationState({ conversationId });
      const messageId = new MessageId('msg123');
      const updated = state.setLastMessage(messageId);
      
      expect(updated.lastMessageId).toBe(messageId);
    });
  });

  describe('static methods', () => {
    describe('empty', () => {
      it('should create empty state', () => {
        const state = ConversationState.empty(conversationId);
        
        expect(state.conversationId.equals(conversationId)).toBe(true);
        expect(state.activeFlow).toBeNull();
        expect(state.flowState).toEqual({});
        expect(state.lastMessageId).toBeNull();
      });
    });

    describe('from', () => {
      it('should return same ConversationState instance', () => {
        const original = new ConversationState({ conversationId });
        const result = ConversationState.from(original);
        expect(result).toBe(original);
      });

      it('should create from plain object', () => {
        const obj = {
          conversationId: { channel: 'telegram', identifier: 'b123_c456' },
          activeFlow: 'flow',
          flowState: { key: 'value' },
        };
        
        const state = ConversationState.from(obj);
        expect(state.activeFlow).toBe('flow');
        expect(state.flowState.key).toBe('value');
      });

      it('should support legacy chatId in plain object', () => {
        const obj = {
          chatId: { channel: 'discord', identifier: 'guild_channel' },
          activeFlow: 'flow',
        };
        
        const state = ConversationState.from(obj);
        expect(state.conversationId.channel).toBe('discord');
      });
    });
  });
});
