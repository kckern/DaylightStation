import { describe, it, expect } from '@jest/globals';
import { Consolidator } from '#apps/newsreporter/Consolidator.mjs';

const fakeRuntime = (outputs) => {
  let i = 0;
  const calls = [];
  return {
    calls,
    execute: async (args) => {
      calls.push(args);
      return { output: outputs[i++] };
    },
  };
};

/** Wrap a runtime as a runtimeFor(model) factory, recording the models requested. */
const factoryFor = (runtime) => {
  const models = [];
  const runtimeFor = (model) => {
    models.push(model);
    return runtime;
  };
  runtimeFor.models = models;
  return runtimeFor;
};

const captureLogger = () => {
  const events = [];
  return { events, info: (e, d) => events.push({ e, d }), debug: () => {}, warn: (e, d) => events.push({ e, d }), error: () => {} };
};

const validReport = JSON.stringify({ sections: [{ type: 'heading', text: 'Scores' }] });

describe('Consolidator', () => {
  it('parses a valid JSON report on the first try', async () => {
    const runtime = fakeRuntime([validReport]);
    const logger = captureLogger();
    const c = new Consolidator({ runtimeFor: factoryFor(runtime), logger, defaultModel: 'm' });
    const { sections } = await c.consolidate({ prompt: 'P', items: [{ a: 1 }], ctx: {} });
    expect(sections).toEqual([{ type: 'heading', text: 'Scores' }]);
    expect(runtime.calls).toHaveLength(1);
    expect(logger.events.find(({ e }) => e === 'newsreporter.consolidate.ok').d).toMatchObject({ sectionCount: 1 });
  });

  it('strips code fences before parsing', async () => {
    const runtime = fakeRuntime(['```json\n' + validReport + '\n```']);
    const c = new Consolidator({ runtimeFor: factoryFor(runtime), logger: captureLogger() });
    const { sections } = await c.consolidate({ prompt: 'P', items: [], ctx: {} });
    expect(sections).toEqual([{ type: 'heading', text: 'Scores' }]);
  });

  it('passes systemPrompt, agentId and stringified items to the runtime', async () => {
    const runtime = fakeRuntime([validReport]);
    const c = new Consolidator({ runtimeFor: factoryFor(runtime), logger: captureLogger() });
    await c.consolidate({ prompt: 'PROMPT_TEXT', items: [{ a: 1 }], ctx: { timezone: 'UTC' } });
    const args = runtime.calls[0];
    expect(args.agentId).toBe('newsreporter-consolidator');
    expect(args.systemPrompt).toContain('PROMPT_TEXT');
    expect(args.systemPrompt).toMatch(/ONLY a JSON object/);
    expect(args.input).toBe(JSON.stringify([{ a: 1 }]));
    expect(args.tools).toEqual([]);
    expect(args.context).toMatchObject({ timezone: 'UTC' });
  });

  it('retries once after invalid output, then succeeds, and logs parse_retry', async () => {
    const runtime = fakeRuntime(['not json at all', validReport]);
    const logger = captureLogger();
    const c = new Consolidator({ runtimeFor: factoryFor(runtime), logger });
    const { sections } = await c.consolidate({ prompt: 'P', items: [], ctx: {} });
    expect(sections).toEqual([{ type: 'heading', text: 'Scores' }]);
    expect(runtime.calls).toHaveLength(2);
    expect(logger.events.some(({ e }) => e === 'newsreporter.consolidate.parse_retry')).toBe(true);
    expect(runtime.calls[1].input).toMatch(/previous output was invalid/i);
  });

  it('throws ApplicationError after two invalid outputs', async () => {
    const runtime = fakeRuntime(['nope', 'still nope']);
    const c = new Consolidator({ runtimeFor: factoryFor(runtime), logger: captureLogger() });
    await expect(c.consolidate({ prompt: 'P', items: [], ctx: {} }))
      .rejects.toThrow(/consolidator/i);
    expect(runtime.calls).toHaveLength(2);
  });

  it('asks runtimeFor for the reporter-specified model', async () => {
    const runtime = fakeRuntime([validReport]);
    const runtimeFor = factoryFor(runtime);
    const c = new Consolidator({ runtimeFor, logger: captureLogger(), defaultModel: 'default-model' });
    await c.consolidate({ prompt: 'P', model: 'openai/gpt-4o', items: [], ctx: {} });
    expect(runtimeFor.models).toEqual(['openai/gpt-4o']);
    // no per-call model is forwarded to the runtime — it is bound at the factory
    expect(runtime.calls[0].model).toBeUndefined();
  });

  it('falls back to defaultModel when no model is specified', async () => {
    const runtime = fakeRuntime([validReport]);
    const runtimeFor = factoryFor(runtime);
    const c = new Consolidator({ runtimeFor, logger: captureLogger(), defaultModel: 'default-model' });
    await c.consolidate({ prompt: 'P', items: [], ctx: {} });
    expect(runtimeFor.models).toEqual(['default-model']);
  });

  it('treats schema-invalid JSON as a parse failure (retries)', async () => {
    const badShape = JSON.stringify({ sections: [{ type: 'bogus' }] });
    const runtime = fakeRuntime([badShape, validReport]);
    const logger = captureLogger();
    const c = new Consolidator({ runtimeFor: factoryFor(runtime), logger });
    const { sections } = await c.consolidate({ prompt: 'P', items: [], ctx: {} });
    expect(sections).toEqual([{ type: 'heading', text: 'Scores' }]);
    expect(logger.events.some(({ e }) => e === 'newsreporter.consolidate.parse_retry')).toBe(true);
  });
});
