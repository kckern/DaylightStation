import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlConversationStore } from '#adapters/agents/YamlConversationStore.mjs';

describe('YamlConversationStore', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-store-'));
    store = new YamlConversationStore({ basePath: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array for unknown conversation', async () => {
    const msgs = await store.getConversation('agent1', 'conv1');
    expect(msgs).toEqual([]);
  });

  it('saves and retrieves messages', async () => {
    await store.saveMessage('agent1', 'conv1', { role: 'user', content: 'hello' });
    await store.saveMessage('agent1', 'conv1', { role: 'assistant', content: 'hi' });
    const msgs = await store.getConversation('agent1', 'conv1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
  });

  it('clears conversation', async () => {
    await store.saveMessage('agent1', 'conv1', { role: 'user', content: 'hello' });
    await store.clearConversation('agent1', 'conv1');
    const msgs = await store.getConversation('agent1', 'conv1');
    expect(msgs).toEqual([]);
  });

  it('lists conversations for an agent', async () => {
    await store.saveMessage('agent1', 'conv1', { role: 'user', content: 'a' });
    await store.saveMessage('agent1', 'conv2', { role: 'user', content: 'b' });
    const list = await store.listConversations('agent1');
    expect(list).toHaveLength(2);
  });

  it('keeps conversations isolated between agents', async () => {
    await store.saveMessage('agent1', 'conv1', { role: 'user', content: 'a' });
    await store.saveMessage('agent2', 'conv1', { role: 'user', content: 'b' });
    const msgs1 = await store.getConversation('agent1', 'conv1');
    const msgs2 = await store.getConversation('agent2', 'conv1');
    expect(msgs1).toHaveLength(1);
    expect(msgs2).toHaveLength(1);
    expect(msgs1[0].content).toBe('a');
    expect(msgs2[0].content).toBe('b');
  });
});
