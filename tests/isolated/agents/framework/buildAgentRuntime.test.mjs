// tests/isolated/agents/framework/buildAgentRuntime.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { buildAgentRuntime } from '../../../../backend/src/3_applications/agents/framework/buildAgentRuntime.mjs';

describe('buildAgentRuntime', () => {
  it('builds a MastraAdapter with the supplied memory', () => {
    const fakeMemory = { __isFakeMemory: true };
    const runtime = buildAgentRuntime(fakeMemory, { logger: console, mediaDir: '/tmp' });
    expect(runtime).toBeDefined();
    expect(typeof runtime.execute).toBe('function');
    expect(typeof runtime.streamExecute).toBe('function');
  });

  it('builds a MastraAdapter with null memory (stateless mode)', () => {
    const runtime = buildAgentRuntime(null, { logger: console, mediaDir: '/tmp' });
    expect(runtime).toBeDefined();
  });

  it('forwards logger and mediaDir from sharedDeps', () => {
    // Construction smoke; behavior covered by MastraAdapter's own tests.
    const runtime = buildAgentRuntime(null, { logger: { info: () => {} }, mediaDir: '/tmp/m' });
    expect(runtime).toBeDefined();
  });

  it('forwards optional agentClass override (test DI hook)', () => {
    class FakeAgent {}
    const runtime = buildAgentRuntime(null, {
      logger: console, mediaDir: '/tmp', agentClass: FakeAgent,
    });
    expect(runtime).toBeDefined();
  });

  it('forwards inputProcessors and outputProcessors to MastraAdapter', () => {
    const fakeIn = { name: 'in' };
    const fakeOut = { name: 'out' };
    const runtime = buildAgentRuntime(null, { logger: console, mediaDir: '/tmp' }, {
      inputProcessors: [fakeIn],
      outputProcessors: [fakeOut],
    });
    expect(runtime).toBeDefined();
    // Just verify no throw; behavior covered by MastraAdapter tests
  });
});
