import { describe, it, expect } from '@jest/globals';
import { LifeplanGuideAgent } from '#apps/agents/lifeplan-guide/LifeplanGuideAgent.mjs';

describe('LifeplanGuideAgent', () => {
  const makeDeps = () => ({
    agentRuntime: { execute: async () => ({ output: '', toolCalls: [] }) },
    workingMemory: { load: async () => ({ serialize: () => '', get: () => null }), save: async () => {} },
    lifePlanStore: { load: () => null },
    goalStateService: {},
    beliefEvaluator: {},
    feedbackService: { recordObservation: () => {} },
    aggregator: { aggregateRange: async () => ({}), getAvailableSources: () => [] },
    metricsStore: { getLatest: () => null },
    driftService: { getLatestSnapshot: () => null },
    ceremonyService: { getCeremonyContent: async () => ({}), completeCeremony: async () => {} },
    ceremonyRecordStore: { hasRecord: () => false, getRecords: () => [] },
    cadenceService: { resolve: () => ({}), isCeremonyDue: () => false },
    notificationService: { send: () => [] },
    conversationStore: { getConversation: async () => [], listConversations: async () => [] },
  });

  it('has correct static properties', () => {
    expect(LifeplanGuideAgent.id).toBe('lifeplan-guide');
    expect(LifeplanGuideAgent.description).toBeDefined();
  });

  it('registers all 5 tool factories', () => {
    const agent = new LifeplanGuideAgent(makeDeps());
    const tools = agent.getTools();
    expect(tools.length).toBeGreaterThanOrEqual(20);

    const names = tools.map(t => t.name);
    expect(names).toContain('get_plan');
    expect(names).toContain('query_lifelog_range');
    expect(names).toContain('get_ceremony_content');
    expect(names).toContain('send_action_message');
    expect(names).toContain('get_conversation_history');
  });

  it('has CadenceCheck assignment registered', () => {
    const agent = new LifeplanGuideAgent(makeDeps());
    const assignments = agent.getAssignments();
    expect(assignments.length).toBeGreaterThanOrEqual(1);
    expect(assignments[0].constructor.id).toBe('cadence-check');
  });
});
