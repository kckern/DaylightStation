// tests/isolated/agents/framework/buildAgentRuntime.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { buildAgentRuntime } from '../../../../backend/src/3_applications/agents/framework/buildAgentRuntime.mjs';
import { MastraAdapter } from '../../../../backend/src/1_adapters/agents/index.mjs';

// The runtime class is injected by the composition root (bootstrap); tests act
// as a mini composition root and pass the real MastraAdapter.
const baseDeps = { AgentRuntime: MastraAdapter };

describe('buildAgentRuntime', () => {
  it('builds a MastraAdapter with the supplied memory', () => {
    const fakeMemory = { __isFakeMemory: true };
    const runtime = buildAgentRuntime(fakeMemory, { ...baseDeps, logger: console, mediaDir: '/tmp' });
    expect(runtime).toBeDefined();
    expect(typeof runtime.execute).toBe('function');
    expect(typeof runtime.streamExecute).toBe('function');
  });

  it('builds a MastraAdapter with null memory (stateless mode)', () => {
    const runtime = buildAgentRuntime(null, { ...baseDeps, logger: console, mediaDir: '/tmp' });
    expect(runtime).toBeDefined();
  });

  it('forwards logger and mediaDir from sharedDeps', () => {
    // Construction smoke; behavior covered by MastraAdapter's own tests.
    const runtime = buildAgentRuntime(null, { ...baseDeps, logger: { info: () => {} }, mediaDir: '/tmp/m' });
    expect(runtime).toBeDefined();
  });

  it('forwards optional agentClass override (test DI hook)', () => {
    class FakeAgent {}
    const runtime = buildAgentRuntime(null, {
      ...baseDeps, logger: console, mediaDir: '/tmp', agentClass: FakeAgent,
    });
    expect(runtime).toBeDefined();
  });

  it('forwards inputProcessors and outputProcessors to MastraAdapter', () => {
    const fakeIn = { name: 'in' };
    const fakeOut = { name: 'out' };
    const runtime = buildAgentRuntime(null, { ...baseDeps, logger: console, mediaDir: '/tmp' }, {
      inputProcessors: [fakeIn],
      outputProcessors: [fakeOut],
    });
    expect(runtime).toBeDefined();
    // Just verify no throw; behavior covered by MastraAdapter tests
  });

  it('constructs the injected runtime class with the assembled options', () => {
    const ctor = vi.fn(function (opts) { this.opts = opts; });
    const fakeMemory = { __m: 1 };
    const runtime = buildAgentRuntime(fakeMemory, {
      AgentRuntime: ctor, logger: console, mediaDir: '/tmp/x', model: 'test-model',
    });
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(runtime.opts).toMatchObject({ mediaDir: '/tmp/x', model: 'test-model', memory: fakeMemory });
  });

  it('throws a clear error when AgentRuntime is not injected', () => {
    expect(() => buildAgentRuntime(null, { logger: console, mediaDir: '/tmp' }))
      .toThrow(/AgentRuntime.*required/);
  });
});
