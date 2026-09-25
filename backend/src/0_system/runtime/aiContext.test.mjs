import { describe, expect, it } from 'vitest';
import { runWithOrigin, currentOrigin } from './aiContext.mjs';

describe('aiContext', () => {
  it('is null outside any run', () => {
    expect(currentOrigin()).toBeNull();
  });

  it('exposes the origin inside a synchronous run and returns its value', () => {
    const out = runWithOrigin('job:alpha', () => currentOrigin());
    expect(out).toBe('job:alpha');
    expect(currentOrigin()).toBeNull();
  });

  it('keeps the origin across await continuations', async () => {
    const seen = await runWithOrigin('http:GET /api/v1/x', async () => {
      await Promise.resolve();
      await new Promise((r) => setImmediate(r));
      return currentOrigin();
    });
    expect(seen).toBe('http:GET /api/v1/x');
  });

  it('keeps the origin in a setTimeout scheduled inside the run', async () => {
    const seen = await new Promise((resolve) => {
      runWithOrigin('tick:artwork', () => {
        setTimeout(() => resolve(currentOrigin()), 1);
      });
    });
    expect(seen).toBe('tick:artwork');
  });

  it('lets an inner run win, then restores the outer origin', async () => {
    const trail = [];
    await runWithOrigin('outer', async () => {
      trail.push(currentOrigin());
      await runWithOrigin('inner', async () => {
        await Promise.resolve();
        trail.push(currentOrigin());
      });
      trail.push(currentOrigin());
    });
    expect(trail).toEqual(['outer', 'inner', 'outer']);
  });

  it('does not leak between concurrent runs', async () => {
    const tick = () => new Promise((r) => setTimeout(r, 2));
    const [a, b] = await Promise.all([
      runWithOrigin('a', async () => { await tick(); return currentOrigin(); }),
      runWithOrigin('b', async () => { await tick(); return currentOrigin(); }),
    ]);
    expect([a, b]).toEqual(['a', 'b']);
  });
});
