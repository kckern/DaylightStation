import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class PlanToolFactory extends ToolFactory {
  static domain = 'lifeplan';

  createTools() {
    const { lifePlanStore, goalStateService, beliefEvaluator, feedbackService } = this.deps;

    return [
      createTool({
        name: 'get_plan',
        description: 'Get the full life plan for a user (goals, beliefs, values, purpose, qualities)',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'User identifier' },
          },
          required: ['username'],
        },
        execute: async ({ username }) => {
          const plan = lifePlanStore.load(username);
          if (!plan) return { error: 'No plan found', goals: [], beliefs: [], values: [] };
          return {
            goals: plan.goals || [],
            beliefs: plan.beliefs || [],
            values: plan.values || [],
            purpose: plan.purpose || null,
            qualities: plan.qualities || [],
          };
        },
      }),

      createTool({
        name: 'propose_goal_transition',
        description: 'Propose a goal state transition. Returns a proposal for user confirmation — does NOT execute the change.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            goalId: { type: 'string', description: 'Goal ID to transition' },
            newState: { type: 'string', description: 'Target state' },
            reasoning: { type: 'string', description: 'Data-backed explanation for the change' },
          },
          required: ['username', 'goalId', 'newState', 'reasoning'],
        },
        execute: async ({ username, goalId, newState, reasoning }) => {
          const plan = lifePlanStore.load(username);
          const goal = plan?.goals?.find(g => g.id === goalId);
          if (!goal) return { error: `Goal ${goalId} not found` };

          const validTransitions = goalStateService.getValidTransitions?.(goal) || [];
          return {
            change: { goalId, goalName: goal.name, from: goal.state, to: newState },
            reasoning,
            confidence: validTransitions.includes(newState) ? 0.9 : 0.5,
            validTransitions,
          };
        },
      }),

      createTool({
        name: 'propose_add_belief',
        description: 'Propose adding a new belief to the plan. Returns a proposal for user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            if_hypothesis: { type: 'string', description: 'The hypothesis (if part)' },
            then_expectation: { type: 'string', description: 'The expected outcome (then part)' },
            reasoning: { type: 'string', description: 'Why this belief is worth testing' },
          },
          required: ['username', 'if_hypothesis', 'reasoning'],
        },
        execute: async ({ username, if_hypothesis, then_expectation, reasoning }) => {
          return {
            change: { type: 'add_belief', if_hypothesis, then_expectation },
            reasoning,
            confidence: 0.7,
          };
        },
      }),

      createTool({
        name: 'propose_reorder_values',
        description: 'Propose a new value ranking order. Returns a proposal for user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            newOrder: { type: 'array', items: { type: 'string' }, description: 'Value IDs in new rank order' },
            reasoning: { type: 'string', description: 'Data-backed explanation for the reorder' },
          },
          required: ['username', 'newOrder', 'reasoning'],
        },
        execute: async ({ username, newOrder, reasoning }) => {
          const plan = lifePlanStore.load(username);
          const currentOrder = (plan?.values || []).sort((a, b) => a.rank - b.rank).map(v => v.id);
          return {
            change: { from: currentOrder, to: newOrder },
            reasoning,
            confidence: 0.8,
          };
        },
      }),

      createTool({
        name: 'propose_add_evidence',
        description: 'Propose adding evidence for a belief. Returns a proposal for user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            beliefId: { type: 'string' },
            type: { type: 'string', description: 'confirmation or disconfirmation' },
            observation: { type: 'string', description: 'What was observed' },
            reasoning: { type: 'string', description: 'Why this counts as evidence' },
          },
          required: ['username', 'beliefId', 'type', 'reasoning'],
        },
        execute: async ({ username, beliefId, type, observation, reasoning }) => {
          const plan = lifePlanStore.load(username);
          const belief = plan?.beliefs?.find(b => b.id === beliefId);
          if (!belief) return { error: `Belief ${beliefId} not found` };

          return {
            change: { beliefId, evidenceType: type, observation },
            reasoning,
            confidence: 0.8,
          };
        },
      }),

      createTool({
        name: 'record_feedback',
        description: 'Record a user observation. Executes immediately (no confirmation needed).',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            observation: { type: 'string', description: 'What the user observed or felt' },
          },
          required: ['username', 'observation'],
        },
        execute: async ({ username, observation }) => {
          feedbackService.recordObservation(username, { text: observation, date: new Date().toISOString() });
          return { recorded: true };
        },
      }),
    ];
  }
}
