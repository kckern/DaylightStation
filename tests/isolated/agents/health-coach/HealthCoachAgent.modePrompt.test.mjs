// tests/isolated/agents/health-coach/HealthCoachAgent.modePrompt.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthCoachAgent } from '../../../../backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs';

function buildBaseDeps() {
  return {
    agentRuntime: { execute: vi.fn(async () => ({ output: 'ok', toolCalls: [] })) },
    workingMemory: { load: vi.fn(async () => null), save: vi.fn() },
    healthStore: { loadHealthData: vi.fn(), loadWeightData: vi.fn(), loadNutritionData: vi.fn() },
    healthService: { getHealthForRange: vi.fn() },
    fitnessPlayableService: { listPlayables: vi.fn() },
    dataService: {},
    messagingGateway: null,
    conversationId: null,
  };
}

describe('HealthCoachAgent.getSystemPrompt mode routing', () => {
  it('returns chatPrompt when mode="chat"', async () => {
    const agent = new HealthCoachAgent(buildBaseDeps());
    const prompt = await agent.getSystemPrompt({ mode: 'chat' });
    expect(prompt).toMatch(/query_health/);
    expect(prompt).toMatch(/compute/);
  });

  it('returns dashboardPrompt when mode="dashboard"', async () => {
    const agent = new HealthCoachAgent(buildBaseDeps());
    const prompt = await agent.getSystemPrompt({ mode: 'dashboard' });
    expect(prompt).toMatch(/Dashboard Output/);
    expect(prompt).toMatch(/Curated Content/);
  });

  it('defaults to chat mode when mode unspecified', async () => {
    const agent = new HealthCoachAgent(buildBaseDeps());
    const prompt = await agent.getSystemPrompt({});
    expect(prompt).toMatch(/query_health/);
  });

  it('defaults to chat mode when called with no args', async () => {
    const agent = new HealthCoachAgent(buildBaseDeps());
    const prompt = await agent.getSystemPrompt();
    expect(prompt).toMatch(/query_health/);
  });

  it('appends personal-context bundle in chat mode when loader is wired', async () => {
    const deps = buildBaseDeps();
    deps.personalContextLoader = {
      load: vi.fn(async () => 'PERSONAL_CONTEXT_BUNDLE'),
      loadPlaybook: vi.fn(async () => ({})),
    };
    const agent = new HealthCoachAgent(deps);
    const prompt = await agent.getSystemPrompt({ mode: 'chat', userId: 'kc' });
    expect(prompt).toMatch(/query_health/);
    expect(prompt).toMatch(/PERSONAL_CONTEXT_BUNDLE/);
  });

  it('appends personal-context bundle in dashboard mode when loader is wired', async () => {
    const deps = buildBaseDeps();
    deps.personalContextLoader = {
      load: vi.fn(async () => 'PERSONAL_CONTEXT_BUNDLE'),
      loadPlaybook: vi.fn(async () => ({})),
    };
    const agent = new HealthCoachAgent(deps);
    const prompt = await agent.getSystemPrompt({ mode: 'dashboard', userId: 'kc' });
    expect(prompt).toMatch(/Dashboard Output/);
    expect(prompt).toMatch(/PERSONAL_CONTEXT_BUNDLE/);
  });

  it('chat-mode prompt includes a "## Period syntax" section', async () => {
    const agent = new HealthCoachAgent(buildBaseDeps());
    const prompt = await agent.getSystemPrompt({ mode: 'chat' });
    expect(prompt).toMatch(/## Period syntax/);
    // The section names the four canonical forms
    expect(prompt).toMatch(/Rolling: \{ "rolling":/);
    expect(prompt).toMatch(/Calendar: \{ "calendar":/);
    expect(prompt).toMatch(/Named: \{ "named":/);
    expect(prompt).toMatch(/Explicit: \{ "from":/);
    // Bare-string shorthand mentioned (so the model knows it works)
    expect(prompt).toMatch(/[Bb]are strings.*shorthand/);
  });

  it('dashboard-mode prompt does NOT include the Period syntax section', async () => {
    const agent = new HealthCoachAgent(buildBaseDeps());
    const prompt = await agent.getSystemPrompt({ mode: 'dashboard' });
    expect(prompt).not.toMatch(/## Period syntax/);
  });
});
