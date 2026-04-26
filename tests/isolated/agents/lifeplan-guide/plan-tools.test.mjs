import { describe, it, expect, beforeEach } from 'vitest';
import { PlanToolFactory } from '#apps/agents/lifeplan-guide/tools/PlanToolFactory.mjs';

describe('PlanToolFactory', () => {
  let factory, tools;
  let mockPlanStore, mockGoalStateService, mockBeliefEvaluator, mockFeedbackService;

  beforeEach(() => {
    mockPlanStore = {
      load: () => ({
        goals: [{ id: 'g1', name: 'Run marathon', state: 'active' }],
        beliefs: [{ id: 'b1', if_hypothesis: 'Running improves mood', state: 'testing', confidence: 0.7 }],
        values: [{ id: 'v1', name: 'Health', rank: 1 }, { id: 'v2', name: 'Career', rank: 2 }],
        purpose: { statement: 'Live fully' },
        qualities: [],
      }),
    };
    mockGoalStateService = {
      getValidTransitions: () => ['progressing', 'paused'],
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

  it('creates 6 tools', () => {
    expect(tools).toHaveLength(6);
    const names = tools.map(t => t.name);
    expect(names).toContain('get_plan');
    expect(names).toContain('propose_goal_transition');
    expect(names).toContain('propose_add_belief');
    expect(names).toContain('propose_reorder_values');
    expect(names).toContain('propose_add_evidence');
    expect(names).toContain('record_feedback');
  });

  it('get_plan returns full plan', async () => {
    const tool = tools.find(t => t.name === 'get_plan');
    const result = await tool.execute({ username: 'testuser' });
    expect(result.goals).toHaveLength(1);
    expect(result.values).toHaveLength(2);
  });

  it('propose_goal_transition returns proposal structure', async () => {
    const tool = tools.find(t => t.name === 'propose_goal_transition');
    const result = await tool.execute({
      username: 'testuser',
      goalId: 'g1',
      newState: 'progressing',
      reasoning: 'Making steady progress',
    });
    expect(result.change).toBeDefined();
    expect(result.reasoning).toBe('Making steady progress');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.validTransitions).toContain('progressing');
  });

  it('propose_reorder_values returns proposal with old and new order', async () => {
    const tool = tools.find(t => t.name === 'propose_reorder_values');
    const result = await tool.execute({
      username: 'testuser',
      newOrder: ['v2', 'v1'],
      reasoning: 'Career taking priority this season',
    });
    expect(result.change.from).toBeDefined();
    expect(result.change.to).toBeDefined();
    expect(result.reasoning).toBeDefined();
  });

  it('record_feedback executes directly (no proposal)', async () => {
    const tool = tools.find(t => t.name === 'record_feedback');
    const result = await tool.execute({
      username: 'testuser',
      observation: 'Feeling more aligned this week',
    });
    expect(result.recorded).toBe(true);
  });
});
