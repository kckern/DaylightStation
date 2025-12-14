/**
 * Tests for MockMessagingGateway
 * @group Phase2
 */

import { MockMessagingGateway } from '../../infrastructure/messaging/MockMessagingGateway.mjs';
import { ChatId } from '../../domain/value-objects/ChatId.mjs';
import { MessageId } from '../../domain/value-objects/MessageId.mjs';
import { isMessagingGateway } from '../../application/ports/IMessagingGateway.mjs';

describe('Phase2: MockMessagingGateway', () => {
  let gateway;
  let chatId;

  beforeEach(() => {
    gateway = new MockMessagingGateway();
    chatId = new ChatId('testbot', 'user123');
  });

  describe('interface compliance', () => {
    it('should implement IMessagingGateway', () => {
      expect(isMessagingGateway(gateway)).toBe(true);
    });
  });

  describe('sendMessage', () => {
    it('should return messageId', async () => {
      const result = await gateway.sendMessage(chatId, 'Hello');
      
      expect(result.messageId).toBeInstanceOf(MessageId);
    });

    it('should record sent message', async () => {
      await gateway.sendMessage(chatId, 'Hello', { inline: true });
      
      const last = gateway.getLastMessage();
      expect(last.text).toBe('Hello');
      expect(last.chatId.identifier).toBe('user123');
      expect(last.options.inline).toBe(true);
    });

    it('should increment messageId', async () => {
      const r1 = await gateway.sendMessage(chatId, 'First');
      const r2 = await gateway.sendMessage(chatId, 'Second');
      
      expect(r2.messageId.toNumber()).toBe(r1.messageId.toNumber() + 1);
    });
  });

  describe('sendImage', () => {
    it('should return messageId', async () => {
      const result = await gateway.sendImage(chatId, 'https://example.com/img.jpg', 'Caption');
      
      expect(result.messageId).toBeInstanceOf(MessageId);
    });

    it('should record image details', async () => {
      await gateway.sendImage(chatId, 'https://example.com/img.jpg', 'My caption');
      
      const last = gateway.getLastMessage();
      expect(last.type).toBe('image');
      expect(last.imageSource).toBe('https://example.com/img.jpg');
      expect(last.caption).toBe('My caption');
    });

    it('should handle Buffer source', async () => {
      const buffer = Buffer.from('fake image data');
      await gateway.sendImage(chatId, buffer, 'Buffer image');
      
      const last = gateway.getLastMessage();
      expect(last.imageSource).toBe('[Buffer]');
    });
  });

  describe('updateMessage', () => {
    it('should record update', async () => {
      const messageId = MessageId.from(123);
      await gateway.updateMessage(chatId, messageId, { text: 'Updated' });
      
      const updates = gateway.getUpdatedMessages();
      expect(updates).toHaveLength(1);
      expect(updates[0].messageId).toBe('123');
      expect(updates[0].updates.text).toBe('Updated');
    });
  });

  describe('updateKeyboard', () => {
    it('should record keyboard update', async () => {
      const messageId = MessageId.from(123);
      await gateway.updateKeyboard(chatId, messageId, [['Yes', 'No']]);
      
      const updates = gateway.getUpdatedMessages();
      expect(updates).toHaveLength(1);
      expect(updates[0].updates.choices).toEqual([['Yes', 'No']]);
    });
  });

  describe('deleteMessage', () => {
    it('should record deletion', async () => {
      const messageId = MessageId.from(456);
      await gateway.deleteMessage(chatId, messageId);
      
      const deleted = gateway.getDeletedMessages();
      expect(deleted).toHaveLength(1);
      expect(deleted[0].messageId).toBe('456');
    });
  });

  describe('transcribeVoice', () => {
    it('should return default transcription', async () => {
      const result = await gateway.transcribeVoice('voice123');
      expect(result).toContain('voice123');
    });

    it('should return configured transcription', async () => {
      gateway.setTranscription('voice123', 'Hello world');
      const result = await gateway.transcribeVoice('voice123');
      expect(result).toBe('Hello world');
    });
  });

  describe('getFileUrl', () => {
    it('should return mock URL by default', async () => {
      const url = await gateway.getFileUrl('file123');
      expect(url).toContain('file123');
    });

    it('should return configured URL', async () => {
      gateway.setFileUrl('file123', 'https://custom.url/file');
      const url = await gateway.getFileUrl('file123');
      expect(url).toBe('https://custom.url/file');
    });
  });

  describe('testing helpers', () => {
    it('getLastMessage should return null when empty', () => {
      expect(gateway.getLastMessage()).toBeNull();
    });

    it('getAllMessages should return all messages', async () => {
      await gateway.sendMessage(chatId, 'First');
      await gateway.sendMessage(chatId, 'Second');
      
      expect(gateway.getAllMessages()).toHaveLength(2);
    });

    it('getMessagesTo should filter by chat', async () => {
      const otherChat = new ChatId('testbot', 'other');
      await gateway.sendMessage(chatId, 'For user123');
      await gateway.sendMessage(otherChat, 'For other');
      
      const filtered = gateway.getMessagesTo(chatId);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].text).toBe('For user123');
    });

    it('setNextMessageId should control IDs', async () => {
      gateway.setNextMessageId(5000);
      const result = await gateway.sendMessage(chatId, 'Test');
      expect(result.messageId.toNumber()).toBe(5000);
    });

    it('reset should clear all state', async () => {
      await gateway.sendMessage(chatId, 'Test');
      await gateway.deleteMessage(chatId, MessageId.from(1));
      gateway.setTranscription('x', 'y');
      
      gateway.reset();
      
      expect(gateway.getAllMessages()).toHaveLength(0);
      expect(gateway.getDeletedMessages()).toHaveLength(0);
    });

    it('messageCount should return count', async () => {
      expect(gateway.messageCount).toBe(0);
      await gateway.sendMessage(chatId, 'Test');
      expect(gateway.messageCount).toBe(1);
    });
  });

  describe('error simulation', () => {
    it('should throw simulated error', async () => {
      gateway.simulateError(new Error('Network error'));
      
      await expect(gateway.sendMessage(chatId, 'Test'))
        .rejects.toThrow('Network error');
    });

    it('should clear error after throwing', async () => {
      gateway.simulateError(new Error('Once'));
      
      await expect(gateway.sendMessage(chatId, 'Test'))
        .rejects.toThrow();
      
      // Second call should succeed
      const result = await gateway.sendMessage(chatId, 'Test 2');
      expect(result.messageId).toBeDefined();
    });

    it('clearError should remove simulated error', async () => {
      gateway.simulateError(new Error('Will be cleared'));
      gateway.clearError();
      
      const result = await gateway.sendMessage(chatId, 'Test');
      expect(result.messageId).toBeDefined();
    });
  });
});
