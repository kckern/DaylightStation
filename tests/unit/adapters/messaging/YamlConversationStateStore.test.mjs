// tests/unit/adapters/messaging/YamlConversationStateStore.test.mjs
import { jest } from '@jest/globals';
import { YamlConversationStateStore } from '../../../../backend/src/2_adapters/messaging/YamlConversationStateStore.mjs';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('YamlConversationStateStore', () => {
  let store;
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conv-state-'));
    store = new YamlConversationStateStore({ basePath: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should return null for non-existent conversation', async () => {
    const state = await store.get('nonexistent');
    expect(state).toBeNull();
  });

  it('should set and get conversation state', async () => {
    const testState = { activeFlow: 'test', flowState: { count: 1 } };
    await store.set('conv123', testState);
    const retrieved = await store.get('conv123');
    expect(retrieved.activeFlow).toBe('test');
    expect(retrieved.flowState.count).toBe(1);
  });

  it('should support message-keyed sessions', async () => {
    await store.set('conv123', { activeFlow: 'flow1' }, 'msg1');
    await store.set('conv123', { activeFlow: 'flow2' }, 'msg2');

    const session1 = await store.get('conv123', 'msg1');
    const session2 = await store.get('conv123', 'msg2');

    expect(session1.activeFlow).toBe('flow1');
    expect(session2.activeFlow).toBe('flow2');
  });

  it('should delete specific session', async () => {
    await store.set('conv123', { activeFlow: 'flow1' }, 'msg1');
    await store.delete('conv123', 'msg1');
    const state = await store.get('conv123', 'msg1');
    expect(state).toBeNull();
  });
});
