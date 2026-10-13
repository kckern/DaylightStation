import { describe, expect, it } from 'vitest';
import { runWithOrigin, currentOrigin, originSlot, runInOriginSlot, currentOriginSlot } from './aiContext.mjs';

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

  it('resolves a function origin lazily, each time it is read', () => {
    let stage = 'before';
    const seen = runWithOrigin(() => `http:GET ${stage}`, () => {
      const first = currentOrigin();
      stage = 'after';
      return [first, currentOrigin()];
    });
    expect(seen).toEqual(['http:GET before', 'http:GET after']);
  });

  it('reads a throwing resolver as no origin', () => {
    expect(runWithOrigin(() => { throw new Error('x'); }, () => currentOrigin())).toBeNull();
  });

  it('settles a resolver slot to its current answer and drops the resolver', async () => {
    const holder = { path: '/a/:id' };
    const slot = originSlot(() => `http:GET ${holder.path}`);
    const later = runInOriginSlot(slot, () => new Promise((r) => setTimeout(() => r(currentOrigin()), 5)));
    slot.settle();
    holder.path = '/changed';
    expect(await later).toBe('http:GET /a/:id');
    expect(slot.resolve).toBeNull();
    expect(slot.value).toBe('http:GET /a/:id');
    slot.settle(); // idempotent
    expect(slot.value).toBe('http:GET /a/:id');
    expect(runInOriginSlot(slot, () => currentOriginSlot())).toBe(slot);
  });
});

