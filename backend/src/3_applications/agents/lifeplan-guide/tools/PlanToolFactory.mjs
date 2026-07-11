import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class PlanToolFactory extends ToolFactory {
  static domain = 'lifeplan';

  createTools() {
    const { lifePlanStore, goalStateService, beliefEvaluator, feedbackService, planAuthoringService } = this.deps;

    const CONFIRM_PREFIX = "Writes to the user's plan. Only call after the user has explicitly confirmed in conversation.";

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

      createTool({
        name: 'create_goal',
        description: `${CONFIRM_PREFIX} Creates a new goal (starts in the 'dream' state). Use during onboarding or when the user commits to a new goal.`,
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'User identifier' },
            name: { type: 'string', description: 'Short name of the goal' },
            why: { type: 'string', description: 'The motivation behind the goal' },
            milestone: { type: 'string', description: 'An optional first milestone' },
          },
          required: ['username', 'name'],
        },
        execute: async ({ username, name, why, milestone }) => {
          try {
            const created = planAuthoringService.addGoal(username, { name, why, milestone });
            return { created };
          } catch (e) {
            return { error: e.message };
          }
        },
      }),

      createTool({
        name: 'add_value',
        description: `${CONFIRM_PREFIX} Adds a value to the plan at the next rank. Use during onboarding or when the user names a value that matters to them.`,
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'User identifier' },
            name: { type: 'string', description: 'Short name of the value (e.g. Health, Family)' },
            description: { type: 'string', description: 'What this value means to the user' },
          },
          required: ['username', 'name'],
        },
        execute: async ({ username, name, description }) => {
          try {
            const created = planAuthoringService.addValue(username, { name, description });
            return { created };
          } catch (e) {
            return { error: e.message };
          }
        },
      }),

      createTool({
        name: 'add_belief',
        description: `${CONFIRM_PREFIX} Adds an if/then belief to test (starts 'hypothesized', confidence 0.5). Use when the user commits to an assumption worth testing.`,
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'User identifier' },
            if_hypothesis: { type: 'string', description: 'The hypothesis (if part)' },
            then_outcome: { type: 'string', description: 'The expected outcome (then part)' },
          },
          required: ['username', 'if_hypothesis', 'then_outcome'],
        },
        execute: async ({ username, if_hypothesis, then_outcome }) => {
          try {
            const created = planAuthoringService.addBelief(username, { if_hypothesis, then_outcome });
            return { created };
          } catch (e) {
            return { error: e.message };
          }
        },
      }),

      createTool({
        name: 'set_purpose',
        description: `${CONFIRM_PREFIX} Sets or replaces the plan's purpose statement. Use when the user articulates their overarching purpose.`,
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'User identifier' },
            statement: { type: 'string', description: 'The purpose statement' },
          },
          required: ['username', 'statement'],
        },
        execute: async ({ username, statement }) => {
          try {
            const created = planAuthoringService.setPurpose(username, { statement });
            return { created };
          } catch (e) {
            return { error: e.message };
          }
        },
      }),
    ];
  }
}
