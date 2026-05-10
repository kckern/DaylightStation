import { describe, it, expect, beforeEach } from 'vitest';
import { CoachingToolFactory } from '#apps/agents/lifeplan-guide/tools/CoachingToolFactory.mjs';

describe('CoachingToolFactory', () => {
  let factory, tools;
  let mockConversationStore, mockWorkingMemory;

  beforeEach(() => {
    mockConversationStore = {
      getConversation: async () => [
        { role: 'user', content: 'hi', timestamp: '2025-06-01T10:00:00Z' },
        { role: 'assistant', content: 'hello', timestamp: '2025-06-01T10:00:01Z' },
      ],
      listConversations: async () => ['2025-06-01', '2025-05-25'],
    };
    mockWorkingMemory = {
      load: async () => ({
        get: (key) => {
          const data = { user_profile: { directness: 'high', nudge_frequency: 'daily' } };
          return data[key] || null;
        },
        set: () => {},
        serialize: () => '',
      }),
      save: async () => {},
    };

    factory = new CoachingToolFactory({
      conversationStore: mockConversationStore,
      workingMemory: mockWorkingMemory,
    });
    tools = factory.createTools();
  });

  it('creates 4 tools (user-preference tools moved to Mastra working memory)', () => {
    expect(tools).toHaveLength(4);
    const names = tools.map(t => t.name);
    expect(names).toContain('get_conversation_history');
    expect(names).toContain('save_session_state');
    expect(names).toContain('resume_session');
    expect(names).toContain('log_agent_feedback');
    // get_user_preferences / update_user_preferences are intentionally absent —
    // user preferences live in Mastra's resource-scoped working memory and are
    // updated via the updateWorkingMemory tool.
    expect(names).not.toContain('get_user_preferences');
    expect(names).not.toContain('update_user_preferences');
  });

  it('get_conversation_history returns messages', async () => {
    const tool = tools.find(t => t.name === 'get_conversation_history');
    const result = await tool.execute({ username: 'test', limit: 10 });
    expect(result.conversations).toBeDefined();
  });

  it('log_agent_feedback records rating', async () => {
    const tool = tools.find(t => t.name === 'log_agent_feedback');
    const result = await tool.execute({ username: 'test', rating: 'positive', context: 'Good advice on values' });
    expect(result.recorded).toBe(true);
  });
});
