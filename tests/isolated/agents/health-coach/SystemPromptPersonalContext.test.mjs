import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HealthCoachAgent } from '../../../../backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs';
import { systemPrompt as staticSystemPrompt } from '../../../../backend/src/3_applications/agents/health-coach/prompts/system.mjs';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * Minimal IAgentRuntime stub — never actually invoked here because we don't
 * call run() or runAssignment(). HealthCoachAgent's BaseAgent constructor only
 * checks that it's truthy.
 */
function buildAgentRuntime() {
  return { execute: vi.fn(async () => ({ output: '{}' })) };
}

/**
 * Minimal IWorkingMemory stub — must expose load/save (BaseAgent constructor
 * only checks truthiness, but child code may call these in some paths).
 */
function buildWorkingMemory() {
  return {
    load: vi.fn(async () => ({ serialize: () => '', pruneExpired: () => {}, set: () => {} })),
    save: vi.fn(async () => {}),
  };
}

/**
 * Build a logger spy that records calls per level. Mirrors the structured
 * logging contract used elsewhere in the agent (info/warn/error/debug).
 */
function buildLogger() {
  const calls = { info: [], warn: [], error: [], debug: [] };
  return {
    info: vi.fn((event, data) => calls.info.push([event, data])),
    warn: vi.fn((event, data) => calls.warn.push([event, data])),
    error: vi.fn((event, data) => calls.error.push([event, data])),
    debug: vi.fn((event, data) => calls.debug.push([event, data])),
    _calls: calls,
  };
}

/**
 * Construct a HealthCoachAgent with the minimum deps required so registerTools()
 * runs without crashing. Tool factories that require store/service refs receive
 * empty stubs — we never invoke any tool here.
 */
function buildAgent({ personalContextLoader, logger } = {}) {
  return new HealthCoachAgent({
    agentRuntime: buildAgentRuntime(),
    workingMemory: buildWorkingMemory(),
    logger: logger || buildLogger(),
    healthStore: {},
    healthService: {},
    fitnessPlayableService: {},
    sessionService: {},
    mediaProgressMemory: {},
    dataService: {},
    configService: { getHeadOfHousehold: () => 'test-user' },
    personalContextLoader,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HealthCoachAgent.getSystemPrompt — PersonalContext injection', () => {
  it('returns the static prompt unchanged when no personalContextLoader is wired', async () => {
    const agent = buildAgent({ personalContextLoader: undefined });

    // Without a loader, calling with or without userId should return the
    // static prompt verbatim — no '## Personal Context' section appended.
    const promptNoArg = await agent.getSystemPrompt();
    const promptWithUser = await agent.getSystemPrompt('test-user');

    expect(promptNoArg).toBe(staticSystemPrompt);
    expect(promptWithUser).toBe(staticSystemPrompt);
    expect(promptNoArg).not.toContain('## Personal Context');
  });

  it('appends the loader bundle to the static prompt when wired', async () => {
    const fakeBundle = '## Personal Context\n\n### Profile\nGoal: lean recomp.\n';
    const personalContextLoader = {
      load: vi.fn(async () => fakeBundle),
    };

    const agent = buildAgent({ personalContextLoader });
    const prompt = await agent.getSystemPrompt('test-user');

    // Static prompt must still be present in full.
    expect(prompt).toContain(staticSystemPrompt);
    // Bundle must be appended.
    expect(prompt).toContain('## Personal Context');
    expect(prompt).toContain('Goal: lean recomp.');
    // Loader was called with the userId.
    expect(personalContextLoader.load).toHaveBeenCalledWith('test-user');
  });

  it('caches the loaded bundle per userId across calls within the same agent instance', async () => {
    const fakeBundle = '## Personal Context\n\n### Profile\nCached.\n';
    const personalContextLoader = {
      load: vi.fn(async () => fakeBundle),
    };

    const agent = buildAgent({ personalContextLoader });

    const a = await agent.getSystemPrompt('test-user');
    const b = await agent.getSystemPrompt('test-user');
    const c = await agent.getSystemPrompt('test-user');

    // Same content every time.
    expect(a).toBe(b);
    expect(b).toBe(c);
    // But loader.load() was only called once — subsequent calls hit the cache.
    expect(personalContextLoader.load).toHaveBeenCalledTimes(1);

    // A different userId triggers a fresh load.
    const otherBundle = '## Personal Context\n\n### Profile\nOther user.\n';
    personalContextLoader.load.mockResolvedValueOnce(otherBundle);
    const d = await agent.getSystemPrompt('other-user');
    expect(d).toContain('Other user.');
    expect(personalContextLoader.load).toHaveBeenCalledTimes(2);
  });

  it('gracefully degrades when loader.load() throws — returns just the static prompt and logs a warning', async () => {
    const personalContextLoader = {
      load: vi.fn(async () => { throw new Error('archive missing'); }),
    };
    const logger = buildLogger();

    const agent = buildAgent({ personalContextLoader, logger });
    const prompt = await agent.getSystemPrompt('test-user');

    // Falls back to static prompt — no Personal Context section.
    expect(prompt).toBe(staticSystemPrompt);
    expect(prompt).not.toContain('## Personal Context');

    // Warning emitted via the structured logger.
    expect(logger.warn).toHaveBeenCalled();
    const warnEvents = logger._calls.warn.map(([event]) => event);
    expect(warnEvents).toContain('health_coach.system_prompt.loader_failed');

    // The error payload includes the userId and an error message for debugging.
    const failureCall = logger._calls.warn.find(([event]) => event === 'health_coach.system_prompt.loader_failed');
    expect(failureCall[1]).toMatchObject({ userId: 'test-user' });
    expect(failureCall[1].error).toMatch(/archive missing/);
  });
});
