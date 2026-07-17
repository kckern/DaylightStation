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
            userId: { type: 'string' },
            limit: { type: 'number', description: 'Max conversations to return', default: 5 },
          },
          required: ['userId'],
        },
        execute: async ({ userId, limit = 5 }) => {
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
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          const memory = await workingMemory.load(agentId, userId);
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
            userId: { type: 'string' },
            rating: { type: 'string', description: 'positive or negative' },
            context: { type: 'string', description: 'What the feedback relates to' },
          },
          required: ['userId', 'rating'],
        },
        execute: async ({ userId, rating, context: feedbackCtx }) => {
          const memory = await workingMemory.load(agentId, userId);
          const feedback = memory.get('agent_feedback') || [];
          feedback.push({ rating, context: feedbackCtx, date: new Date().toISOString() });
          memory.set('agent_feedback', feedback.slice(-50));
          await workingMemory.save(agentId, userId, memory);
          return { recorded: true };
        },
      }),

      // NOTE: user-preference state (directness, nudge frequency, challenge
      // level, etc.) lives in Mastra's resource-scoped working memory, accessed
      // via the `updateWorkingMemory` tool. Do NOT add per-agent preference
      // tools here — they fork the source of truth from the shared user model.
    ];
  }
}
