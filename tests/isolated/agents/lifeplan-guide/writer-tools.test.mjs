import { describe, it, expect, vi } from 'vitest';
import { PlanToolFactory } from '#apps/agents/lifeplan-guide/tools/PlanToolFactory.mjs';

// Real service signatures, confirmed by reading backend/src/4_api/v1/routers/life/plan.mjs:
//   POST /goals/:goalId/transition  -> goalStateService.transition(goal, newState, reason)
//   POST /beliefs/:id/evidence      -> beliefEvaluator.evaluateEvidence(belief, evidenceBody)
// Both handlers re-save the plan via lifePlanStore.save(username, plan) after mutating.

describe('PlanToolFactory writer tools', () => {
  it('exposes transition_goal / add_evidence writers and no propose_* tools', () => {
    const factory = new PlanToolFactory({
      lifePlanStore: { load: () => ({}), save: vi.fn() },
      goalStateService: { transition: vi.fn() },
      beliefEvaluator: { evaluateEvidence: vi.fn() },
      feedbackService: {},
      planAuthoringService: {},
    });
    const names = factory.createTools().map((t) => t.name);

    expect(names).not.toContain('propose_goal_transition');
    expect(names).not.toContain('propose_add_belief');
    expect(names).not.toContain('propose_reorder_values');
    expect(names).not.toContain('propose_add_evidence');
    expect(names).toContain('transition_goal');
    expect(names).toContain('add_evidence');
  });

  it('transition_goal calls goalStateService.transition and persists via lifePlanStore.save', async () => {
    const goal = { id: 'g1', state: 'considered' };
    const plan = { goals: [goal], beliefs: [] };
    const save = vi.fn();
    const transition = vi.fn((g, state) => { g.state = state; });
    const factory = new PlanToolFactory({
      lifePlanStore: { load: () => plan, save },
      goalStateService: { transition },
      beliefEvaluator: { evaluateEvidence: vi.fn() },
      feedbackService: {},
      planAuthoringService: {},
    });
    const tool = factory.createTools().find((t) => t.name === 'transition_goal');

    const result = await tool.execute({ userId: 'u1', goalId: 'g1', state: 'committed', reason: 'ready to commit' });

    expect(transition).toHaveBeenCalledWith(goal, 'committed', 'ready to commit');
    expect(save).toHaveBeenCalledWith('u1', plan);
    expect(result.updated.state).toBe('committed');
  });

  it('transition_goal errors on an unknown goal without calling the service or saving', async () => {
    const save = vi.fn();
    const transition = vi.fn();
    const factory = new PlanToolFactory({
      lifePlanStore: { load: () => ({ goals: [], beliefs: [] }), save },
      goalStateService: { transition },
      beliefEvaluator: { evaluateEvidence: vi.fn() },
      feedbackService: {},
      planAuthoringService: {},
    });
    const tool = factory.createTools().find((t) => t.name === 'transition_goal');

    const result = await tool.execute({ userId: 'u1', goalId: 'missing', state: 'committed' });

    expect(result.error).toMatch(/not found/);
    expect(transition).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('add_evidence calls beliefEvaluator.evaluateEvidence and persists via lifePlanStore.save', async () => {
    const belief = { id: 'b1', evidence_history: [] };
    const plan = { goals: [], beliefs: [belief] };
    const save = vi.fn();
    const evaluateEvidence = vi.fn((b, evidence) => { b.evidence_history.push(evidence); });
    const factory = new PlanToolFactory({
      lifePlanStore: { load: () => plan, save },
      goalStateService: { transition: vi.fn() },
      beliefEvaluator: { evaluateEvidence },
      feedbackService: {},
      planAuthoringService: {},
    });
    const tool = factory.createTools().find((t) => t.name === 'add_evidence');

    const result = await tool.execute({ userId: 'u1', beliefId: 'b1', type: 'confirmation', note: 'Ran 3x this week' });

    expect(evaluateEvidence).toHaveBeenCalledWith(belief, { type: 'confirmation', note: 'Ran 3x this week' });
    expect(save).toHaveBeenCalledWith('u1', plan);
    expect(result.updated.evidence_history).toHaveLength(1);
  });

  it('add_evidence errors on an unknown belief without calling the service or saving', async () => {
    const save = vi.fn();
    const evaluateEvidence = vi.fn();
    const factory = new PlanToolFactory({
      lifePlanStore: { load: () => ({ goals: [], beliefs: [] }), save },
      goalStateService: { transition: vi.fn() },
      beliefEvaluator: { evaluateEvidence },
      feedbackService: {},
      planAuthoringService: {},
    });
    const tool = factory.createTools().find((t) => t.name === 'add_evidence');

    const result = await tool.execute({ userId: 'u1', beliefId: 'missing', type: 'confirmation' });

    expect(result.error).toMatch(/not found/);
    expect(evaluateEvidence).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
