import { describe, it, expect, vi } from 'vitest';
import { createCallLimiter } from './CallLimiter.mjs';

function makeTool() {
  return {
    name: 'foo',
    description: 'd',
    parameters: { type: 'object' },
    execute: vi.fn(async () => ({ ok: true })),
  };
}

describe('createCallLimiter', () => {
  it('allows calls up to maxToolCalls', async () => {
    const limiter = createCallLimiter({ maxToolCalls: 3 });
    const wrapped = limiter(makeTool(), {});
    const r1 = await wrapped.execute({});
    const r2 = await wrapped.execute({});
    const r3 = await wrapped.execute({});
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
  });

  it('returns an error envelope after maxToolCalls is exceeded', async () => {
    const limiter = createCallLimiter({ maxToolCalls: 2 });
    const wrapped = limiter(makeTool(), {});
    await wrapped.execute({});
    await wrapped.execute({});
    const r3 = await wrapped.execute({});
    expect(r3.error).toMatch(/limit reached/i);
  });

  it('shares the counter across multiple wrapped tools', async () => {
    const limiter = createCallLimiter({ maxToolCalls: 2 });
    const t1 = limiter(makeTool(), {});
    const t2 = limiter(makeTool(), {});
    await t1.execute({});
    await t2.execute({});
    const r3 = await t1.execute({});
    expect(r3.error).toMatch(/limit reached/i);
  });

  it('does not call underlying execute when limit exceeded', async () => {
    const limiter = createCallLimiter({ maxToolCalls: 1 });
    const tool = makeTool();
    const wrapped = limiter(tool, {});
    await wrapped.execute({});
    await wrapped.execute({});  // exceeds limit
    expect(tool.execute).toHaveBeenCalledTimes(1);
  });

  it('default maxToolCalls is reasonable (50)', async () => {
    const limiter = createCallLimiter();
    const wrapped = limiter(makeTool(), {});
    for (let i = 0; i < 50; i++) {
      const r = await wrapped.execute({});
      expect(r.ok).toBe(true);
    }
    const r51 = await wrapped.execute({});
    expect(r51.error).toMatch(/limit reached/i);
  });
});
