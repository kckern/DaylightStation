import { describe, it, expect, vi } from 'vitest';
import { policyDecorator } from './PolicyDecorator.mjs';

function makeTool(executeFn) {
  return {
    name: 'control_lights',
    description: 'Toggle lights',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: executeFn ?? vi.fn(async () => ({ ok: true })),
    defaultPolicy: 'open',
    getScopesFor: () => ['ha:lights'],
  };
}

function makePolicy({ allow = true, reason = null } = {}) {
  return {
    evaluateToolCall: vi.fn(() => ({ allow, reason })),
  };
}

describe('policyDecorator — pass-through when no policy', () => {
  it('calls original execute when context.policy is null', async () => {
    const innerExecute = vi.fn(async () => ({ ok: true }));
    const tool = makeTool(innerExecute);
    const wrapped = policyDecorator(tool, { policy: null });
    const result = await wrapped.execute({ brightness: 50 }, {});
    expect(innerExecute).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true });
  });

  it('calls original execute when context has no policy key', async () => {
    const innerExecute = vi.fn(async () => ({ ok: true }));
    const tool = makeTool(innerExecute);
    const wrapped = policyDecorator(tool, {});
    await wrapped.execute({}, {});
    expect(innerExecute).toHaveBeenCalledOnce();
  });
});

describe('policyDecorator — policy allow', () => {
  it('calls evaluateToolCall with the right arguments', async () => {
    const tool = makeTool();
    const policy = makePolicy({ allow: true });
    const satellite = { id: 'kitchen', area: 'kitchen' };
    const context = { policy, satellite };
    const wrapped = policyDecorator(tool, context);
    await wrapped.execute({ brightness: 80 }, context);
    expect(policy.evaluateToolCall).toHaveBeenCalledWith(
      satellite,
      'control_lights',
      { brightness: 80 },
      tool,
      null,
    );
  });

  it('forwards to inner execute when policy allows', async () => {
    const innerExecute = vi.fn(async () => ({ ok: true, state: 'on' }));
    const tool = makeTool(innerExecute);
    const context = { policy: makePolicy({ allow: true }), satellite: {} };
    const wrapped = policyDecorator(tool, context);
    const result = await wrapped.execute({}, context);
    expect(innerExecute).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, state: 'on' });
  });
});

describe('policyDecorator — policy deny', () => {
  it('returns denied envelope without calling inner execute', async () => {
    const innerExecute = vi.fn();
    const tool = makeTool(innerExecute);
    const policy = makePolicy({ allow: false, reason: 'uncovered:ha:lights' });
    const context = { policy, satellite: { id: 'tv' } };
    const wrapped = policyDecorator(tool, context);
    const result = await wrapped.execute({}, context);
    expect(innerExecute).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/policy_denied/);
  });

  it('records policyDecision on context.transcript when provided', async () => {
    const tool = makeTool();
    const policy = makePolicy({ allow: false, reason: 'satellite:ha:*' });
    const transcript = { recordTool: vi.fn() };
    const context = { policy, satellite: { id: 'tv' }, transcript };
    const wrapped = policyDecorator(tool, context);
    await wrapped.execute({ scene: 'movie' }, context);
    expect(transcript.recordTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'control_lights',
      ok: false,
      policyDecision: { allowed: false, reason: 'satellite:ha:*' },
    }));
  });
});

describe('policyDecorator — tool field preservation', () => {
  it('preserves name, description, and parameters', () => {
    const tool = makeTool();
    const wrapped = policyDecorator(tool, {});
    expect(wrapped.name).toBe('control_lights');
    expect(wrapped.description).toBe('Toggle lights');
    expect(wrapped.parameters).toEqual(tool.parameters);
  });

  it('preserves defaultPolicy and getScopesFor', () => {
    const tool = makeTool();
    const wrapped = policyDecorator(tool, {});
    expect(wrapped.defaultPolicy).toBe('open');
    expect(typeof wrapped.getScopesFor).toBe('function');
  });
});
