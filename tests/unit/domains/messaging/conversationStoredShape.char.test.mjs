// Characterization test: the STORED YAML SHAPE of a conversation must not change
// across the serialization-ownership migration (docs/_wip/plans/
// 2026-07-08-serialization-ownership-migration.md, phase 1).
// It round-trips a conversation with 2 messages through ConversationService +
// YamlConversationDatastore against a temp data root and asserts the exact
// on-disk shape. This test must pass BEFORE and AFTER the refactor.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { YamlConversationDatastore } from '#adapters/persistence/yaml/YamlConversationDatastore.mjs';
import { ConversationService } from '#domains/messaging/services/ConversationService.mjs';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function makeDataService(root) {
  return {
    getDataRoot: () => root,
    household: {
      resolveDir: (rel, hid) =>
        path.join(root, hid === 'default' ? 'household' : `household-${hid}`, rel)
    }
  };
}

describe('conversation stored YAML shape (characterization)', () => {
  let root;
  let service;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'conv-shape-'));
    const store = new YamlConversationDatastore({
      dataService: makeDataService(root),
      logger: noopLogger
    });
    service = new ConversationService({ conversationStore: store });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stores the canonical shape after a 2-message round-trip', async () => {
    const conv = await service.createConversation({
      participants: ['john', 'jane'],
      nowMs: 1751900000000,
      timestamp: '2026-07-07T10:00:00.000Z',
      metadata: { topic: 'test' }
    });

    await service.addMessage(conv.id, {
      id: 'msg-1',
      senderId: 'john',
      recipientId: 'jane',
      content: 'Hello',
      type: 'text'
    }, '2026-07-07T10:00:01.000Z');

    await service.addMessage(conv.id, {
      id: 'msg-2',
      senderId: 'jane',
      recipientId: 'john',
      content: 'Hi back',
      type: 'text'
    }, '2026-07-07T10:00:02.000Z');

    const file = path.join(
      root, 'household', 'shared/messaging/conversations', `${conv.id}.yml`
    );
    const stored = yaml.load(readFileSync(file, 'utf8'));

    expect(stored).toEqual({
      id: conv.id,
      participants: ['john', 'jane'],
      messages: [
        {
          id: 'msg-1',
          conversationId: conv.id,
          senderId: 'john',
          recipientId: 'jane',
          type: 'text',
          direction: null,
          content: 'Hello',
          attachments: [],
          timestamp: '2026-07-07T10:00:01.000Z',
          metadata: {}
        },
        {
          id: 'msg-2',
          conversationId: conv.id,
          senderId: 'jane',
          recipientId: 'john',
          type: 'text',
          direction: null,
          content: 'Hi back',
          attachments: [],
          timestamp: '2026-07-07T10:00:02.000Z',
          metadata: {}
        }
      ],
      startedAt: '2026-07-07T10:00:00.000Z',
      lastMessageAt: '2026-07-07T10:00:02.000Z',
      metadata: { topic: 'test' }
    });
  });

  it('reads back messages faithfully through the service', async () => {
    const conv = await service.createConversation({
      participants: ['john', 'jane'],
      nowMs: 1751900000000,
      timestamp: '2026-07-07T10:00:00.000Z'
    });
    await service.addMessage(conv.id, {
      id: 'msg-1', senderId: 'john', recipientId: 'jane', content: 'Hello', type: 'text'
    }, '2026-07-07T10:00:01.000Z');
    await service.addMessage(conv.id, {
      id: 'msg-2', senderId: 'jane', recipientId: 'john', content: 'Hi back', type: 'text'
    }, '2026-07-07T10:00:02.000Z');

    const messages = await service.getMessages(conv.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].getText()).toBe('Hello');
    expect(messages[1].getText()).toBe('Hi back');
    expect(messages[1].senderId).toBe('jane');

    const summary = await service.getConversationSummary(conv.id);
    expect(summary.messageCount).toBe(2);
    expect(summary.lastMessageAt).toBe('2026-07-07T10:00:02.000Z');
  });
});
