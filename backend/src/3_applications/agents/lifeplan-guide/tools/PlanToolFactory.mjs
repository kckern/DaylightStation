import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';
import { LifeEventType } from '#domains/lifeplan/value-objects/LifeEventType.mjs';

export class PlanToolFactory extends ToolFactory {
  static domain = 'lifeplan';

  createTools() {
    const { lifePlanStore, goalStateService, beliefEvaluator, feedbackService, planAuthoringService, lifeEventSuggester, clock } = this.deps;

    const CONFIRM_PREFIX = "Writes to the user's plan. Only call after the user has explicitly confirmed in conversation.";

    return [
      createTool({
        name: 'get_plan',
        description: 'Get the full life plan for a user (goals, beliefs, values, purpose, qualities)',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
          },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          const plan = lifePlanStore.load(userId);
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
        name: 'transition_goal',
        description: `${CONFIRM_PREFIX} Move an existing goal to a new state (e.g. considered → committed).`,
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            goalId: { type: 'string', description: 'Goal ID to transition' },
            state: { type: 'string', description: 'Target state' },
            reason: { type: 'string', description: 'Why this transition is happening' },
          },
          required: ['userId', 'goalId', 'state'],
        },
        execute: async ({ userId, goalId, state, reason }) => {
          try {
            const plan = lifePlanStore.load(userId);
            const goal = plan?.goals?.find(g => g.id === goalId);
            if (!goal) return { error: `Goal ${goalId} not found` };

            goalStateService.transition(goal, state, reason, clock.now());
            lifePlanStore.save(userId, plan);
            return { updated: goal };
          } catch (e) {
            return { error: e.message };
          }
        },
      }),

      createTool({
        name: 'add_evidence',
        description: `${CONFIRM_PREFIX} Record a piece of evidence for or against an existing belief.`,
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            beliefId: { type: 'string', description: 'Belief ID to add evidence to' },
            type: { type: 'string', description: 'confirmation, disconfirmation, spurious, or untested' },
            note: { type: 'string', description: 'What was observed' },
          },
          required: ['userId', 'beliefId', 'type'],
        },
        execute: async ({ userId, beliefId, type, note }) => {
          try {
            const plan = lifePlanStore.load(userId);
            const belief = plan?.beliefs?.find(b => b.id === beliefId);
            if (!belief) return { error: `Belief ${beliefId} not found` };

            beliefEvaluator.evaluateEvidence(belief, { type, note }, clock.now());
            lifePlanStore.save(userId, plan);
            return { updated: belief };
          } catch (e) {
            return { error: e.message };
          }
        },
      }),

      createTool({
        name: 'record_feedback',
        description: 'Record a user observation. Executes immediately (no confirmation needed).',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            observation: { type: 'string', description: 'What the user observed or felt' },
          },
          required: ['userId', 'observation'],
        },
        execute: async ({ userId, observation }) => {
          feedbackService.recordObservation(userId, { text: observation, date: clock.now().toISOString() });
          return { recorded: true };
        },
      }),

      createTool({
        name: 'create_goal',
        description: `${CONFIRM_PREFIX} Creates a new goal (starts in the 'dream' state). Use during onboarding or when the user commits to a new goal.`,
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            name: { type: 'string', description: 'Short name of the goal' },
            why: { type: 'string', description: 'The motivation behind the goal' },
            milestone: { type: 'string', description: 'An optional first milestone' },
          },
          required: ['userId', 'name'],
        },
        execute: async ({ userId, name, why, milestone }) => {
          try {
            const created = planAuthoringService.addGoal(userId, { name, why, milestone });
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
            userId: { type: 'string', description: 'User identifier' },
            name: { type: 'string', description: 'Short name of the value (e.g. Health, Family)' },
            description: { type: 'string', description: 'What this value means to the user' },
          },
          required: ['userId', 'name'],
        },
        execute: async ({ userId, name, description }) => {
          try {
            const created = planAuthoringService.addValue(userId, { name, description });
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
            userId: { type: 'string', description: 'User identifier' },
            if_hypothesis: { type: 'string', description: 'The hypothesis (if part)' },
            then_outcome: { type: 'string', description: 'The expected outcome (then part)' },
          },
          required: ['userId', 'if_hypothesis', 'then_outcome'],
        },
        execute: async ({ userId, if_hypothesis, then_outcome }) => {
          try {
            const created = planAuthoringService.addBelief(userId, { if_hypothesis, then_outcome });
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
            userId: { type: 'string', description: 'User identifier' },
            statement: { type: 'string', description: 'The purpose statement' },
          },
          required: ['userId', 'statement'],
        },
        execute: async ({ userId, statement }) => {
          try {
            const created = planAuthoringService.setPurpose(userId, { statement });
            return { created };
          } catch (e) {
            return { error: e.message };
          }
        },
      }),

      createTool({
        name: 'suggest_life_events',
        description: "Read-only. Scans the user's recent calendar for items that look like life events (a move, a job change, a wedding or funeral, surgery, a graduation, a major financial change). Returns suggestions only: offer them to the user in plain words, and call add_life_event only for the ones they confirm.",
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            days: { type: 'number', description: 'How many days back to scan (default 14, max 60)' },
          },
          required: ['userId'],
        },
        execute: async ({ userId, days }) => {
          if (!lifeEventSuggester) return { error: 'Life event suggestions are not available', suggestions: [] };
          try {
            const result = await lifeEventSuggester.suggest(userId, { days });
            return { suggestions: result.suggestions, window: { start: result.startDate, end: result.endDate } };
          } catch (e) {
            return { error: e.message, suggestions: [] };
          }
        },
      }),

      createTool({
        name: 'add_life_event',
        description: `${CONFIRM_PREFIX} Records a life event in the plan. When it came from suggest_life_events, pass that suggestion as fromSuggestion unchanged.`,
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            type: { type: 'string', enum: [...LifeEventType.values()] },
            subtype: { type: 'string', description: 'Finer kind, e.g. relocation, job_change, family_event' },
            name: { type: 'string', description: 'Short name, e.g. "Moved to Denver"' },
            status: { type: 'string', enum: ['anticipated', 'occurred'] },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            fromSuggestion: { type: 'object', description: 'The suggestion this came from, if any' },
          },
          required: ['userId', 'type', 'name', 'status'],
        },
        execute: async ({ userId, type, subtype, name, status, date, fromSuggestion }) => {
          try {
            const signal = fromSuggestion
              ? { source: fromSuggestion.source || 'calendar', date: fromSuggestion.date ?? date ?? null,
                detector: fromSuggestion.detector ?? null, confidence: fromSuggestion.confidence ?? null }
              : null;
            const created = planAuthoringService.addLifeEvent(userId, { type, subtype, name, status, date, signal });
            lifeEventSuggester?.noteConfirmed?.(userId, created);
            return { created };
          } catch (e) {
            return { error: e.message };
          }
        },
      }),
    ];
  }
}
