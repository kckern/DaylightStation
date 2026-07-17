import { describe, it, expect, beforeEach } from 'vitest';
import { PlanToolFactory } from '#apps/agents/lifeplan-guide/tools/PlanToolFactory.mjs';

describe('PlanToolFactory', () => {
  let factory, tools;
  let mockPlanStore, mockGoalStateService, mockBeliefEvaluator, mockFeedbackService;

  beforeEach(() => {
    mockPlanStore = {
      load: () => ({
        goals: [{ id: 'g1', name: 'Run marathon', state: 'active' }],
        beliefs: [{ id: 'b1', if_hypothesis: 'Running improves mood', state: 'testing', confidence: 0.7, evidence_history: [] }],
        values: [{ id: 'v1', name: 'Health', rank: 1 }, { id: 'v2', name: 'Career', rank: 2 }],
        purpose: { statement: 'Live fully' },
        qualities: [],
      }),
      save: () => {},
    };
    mockGoalStateService = {
      transition: (goal, newState, reason) => {
        goal.state = newState;
        goal.lastTransitionReason = reason;
      },
    };
    mockBeliefEvaluator = {
      evaluateEvidence: (belief, evidence) => {
        belief.evidence_history = belief.evidence_history || [];
        belief.evidence_history.push(evidence);
      },
    };
    mockFeedbackService = {
      recordObservation: () => {},
    };

    factory = new PlanToolFactory({
      lifePlanStore: mockPlanStore,
      goalStateService: mockGoalStateService,
      beliefEvaluator: mockBeliefEvaluator,
      feedbackService: mockFeedbackService,
    });
    tools = factory.createTools();
  });

  it('creates 8 tools (read + confirmed-write)', () => {
    expect(tools).toHaveLength(8);
    const names = tools.map(t => t.name);
    expect(names).toContain('get_plan');
    expect(names).toContain('record_feedback');
    expect(names).toContain('create_goal');
    expect(names).toContain('add_value');
    expect(names).toContain('add_belief');
    expect(names).toContain('set_purpose');
    expect(names).toContain('transition_goal');
    expect(names).toContain('add_evidence');
    expect(names).not.toContain('propose_goal_transition');
    expect(names).not.toContain('propose_add_belief');
    expect(names).not.toContain('propose_reorder_values');
    expect(names).not.toContain('propose_add_evidence');
  });

  it('get_plan returns full plan', async () => {
    const tool = tools.find(t => t.name === 'get_plan');
    const result = await tool.execute({ userId: 'testuser' });
    expect(result.goals).toHaveLength(1);
    expect(result.values).toHaveLength(2);
  });

  it('transition_goal moves an existing goal to a new state', async () => {
    const tool = tools.find(t => t.name === 'transition_goal');
    const result = await tool.execute({
      userId: 'testuser',
      goalId: 'g1',
      state: 'progressing',
      reason: 'Making steady progress',
    });
    expect(result.updated).toBeDefined();
    expect(result.updated.state).toBe('progressing');
  });

  it('transition_goal errors when the goal does not exist', async () => {
    const tool = tools.find(t => t.name === 'transition_goal');
    const result = await tool.execute({ userId: 'testuser', goalId: 'nope', state: 'progressing' });
    expect(result.error).toBeDefined();
  });

  it('add_evidence records evidence against an existing belief', async () => {
    const tool = tools.find(t => t.name === 'add_evidence');
    const result = await tool.execute({
      userId: 'testuser',
      beliefId: 'b1',
      type: 'confirmation',
      note: 'Felt noticeably better after a run',
    });
    expect(result.updated).toBeDefined();
    expect(result.updated.evidence_history).toHaveLength(1);
    expect(result.updated.evidence_history[0].type).toBe('confirmation');
  });

  it('add_evidence errors when the belief does not exist', async () => {
    const tool = tools.find(t => t.name === 'add_evidence');
    const result = await tool.execute({ userId: 'testuser', beliefId: 'nope', type: 'confirmation' });
    expect(result.error).toBeDefined();
  });

  it('record_feedback executes directly (no proposal)', async () => {
    const tool = tools.find(t => t.name === 'record_feedback');
    const result = await tool.execute({
      userId: 'testuser',
      observation: 'Feeling more aligned this week',
    });
    expect(result.recorded).toBe(true);
  });
});
