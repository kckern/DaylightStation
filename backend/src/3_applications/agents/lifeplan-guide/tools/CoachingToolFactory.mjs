import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class CoachingToolFactory extends ToolFactory {
  static domain = 'coaching';

  createTools() {
    const { conversationStore, workingMemory } = this.deps;
    const agentId = 'lifeplan-guide';

    return [
      createTool({
        name: 'get_conversation_history',
        description: 'Get recent conversation threads with the user for context continuity.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            limit: { type: 'number', description: 'Max conversations to return', default: 5 },
          },
          required: ['username'],
        },
        execute: async ({ username, limit = 5 }) => {
          const convIds = await conversationStore.listConversations(agentId);
          const recent = convIds.slice(-limit);
          const conversations = [];
          for (const id of recent) {
            const msgs = await conversationStore.getConversation(agentId, id);
            conversations.push({ id, messages: msgs });
          }
          return { conversations };
        },
      }),

      createTool({
        name: 'save_session_state',
        description: 'Persist current conversation flow state for resumability.',
        parameters: {
          type: 'object',
          properties: {
            flow: { type: 'string', description: 'Flow type: onboarding, ceremony, coaching' },
            type: { type: 'string', description: 'Ceremony type if flow is ceremony' },
            step: { type: 'number', description: 'Current step index' },
            partialResponses: { type: 'array', description: 'Responses collected so far' },
          },
          required: ['flow', 'step'],
        },
        execute: async ({ flow, type, step, partialResponses = [] }, context) => {
          const userId = context?.userId;
          if (!userId) return { error: 'No userId in context' };
          const memory = await workingMemory.load(agentId, userId);
          memory.set('session_state', { flow, type, step, partialResponses, startedAt: new Date().toISOString() }, { ttl: 7 * 24 * 60 * 60 * 1000 });
          await workingMemory.save(agentId, userId, memory);
          return { saved: true };
        },
      }),

      createTool({
        name: 'resume_session',
        description: 'Load active session state to resume an interrupted conversation.',
        parameters: {
          type: 'object',
          properties: { username: { type: 'string' } },
          required: ['username'],
        },
        execute: async ({ username }) => {
          const memory = await workingMemory.load(agentId, username);
          const session = memory.get('session_state');
          return session || { active: false };
        },
      }),

      createTool({
        name: 'log_agent_feedback',
        description: 'Record user feedback on agent suggestions to improve future coaching.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            rating: { type: 'string', description: 'positive or negative' },
            context: { type: 'string', description: 'What the feedback relates to' },
          },
          required: ['username', 'rating'],
        },
        execute: async ({ username, rating, context: feedbackCtx }) => {
          const memory = await workingMemory.load(agentId, username);
          const feedback = memory.get('agent_feedback') || [];
          feedback.push({ rating, context: feedbackCtx, date: new Date().toISOString() });
          memory.set('agent_feedback', feedback.slice(-50));
          await workingMemory.save(agentId, username, memory);
          return { recorded: true };
        },
      }),

      createTool({
        name: 'get_user_preferences',
        description: 'Load user coaching style preferences (directness, nudge frequency, challenge level).',
        parameters: {
          type: 'object',
          properties: { username: { type: 'string' } },
          required: ['username'],
        },
        execute: async ({ username }) => {
          const memory = await workingMemory.load(agentId, username);
          return memory.get('user_profile') || {
            directness: 'moderate',
            nudge_frequency: 'daily',
            challenge_level: 'moderate',
          };
        },
      }),

      createTool({
        name: 'update_user_preferences',
        description: 'Save user coaching style preferences.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            preferences: { type: 'object', description: 'Preference key-value pairs to merge' },
          },
          required: ['username', 'preferences'],
        },
        execute: async ({ username, preferences }) => {
          const memory = await workingMemory.load(agentId, username);
          const current = memory.get('user_profile') || {};
          memory.set('user_profile', { ...current, ...preferences });
          await workingMemory.save(agentId, username, memory);
          return { updated: true };
        },
      }),
    ];
  }
}
