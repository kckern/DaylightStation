// tests/isolated/agents/health-coach/compute.test.mjs
import { describe, it, expect } from 'vitest';
import { ComputeSandbox } from '../../../../backend/src/3_applications/agents/health-coach/services/ComputeSandbox.mjs';

describe('ComputeSandbox.evaluate', () => {
  const sandbox = new ComputeSandbox();

  it('evaluates basic arithmetic', () => {
    const r = sandbox.evaluate('1 + 2 * 3');
    expect(r.value).toBe(7);
    expect(r.type).toBe('number');
  });

  it('binds named inputs as identifiers', () => {
    const r = sandbox.evaluate('a + b', { a: 5, b: 10 });
    expect(r.value).toBe(15);
  });

  it('handles object property access on inputs', () => {
    const r = sandbox.evaluate('result.slope * 30', { result: { slope: -0.0014, intercept: 170.36 } });
    expect(r.value).toBeCloseTo(-0.042, 3);
  });

  it('exposes Math object', () => {
    const r = sandbox.evaluate('Math.sqrt(16) + Math.PI');
    expect(r.value).toBeCloseTo(4 + Math.PI, 5);
  });

  it('returns boolean when expression is comparison', () => {
    const r = sandbox.evaluate('density >= 0.8', { density: 0.42 });
    expect(r.value).toBe(false);
    expect(r.type).toBe('boolean');
  });

  it('rejects access to require', () => {
    const r = sandbox.evaluate('require("fs")');
    expect(r.error).toBe('runtime');
  });

  it('rejects access to process', () => {
    const r = sandbox.evaluate('process.env.SECRET');
    expect(r.error).toBe('runtime');
  });

  it('rejects eval', () => {
    const r = sandbox.evaluate('eval("1+1")');
    expect(r.error).toBe('runtime');
  });

  it('rejects Function constructor', () => {
    const r = sandbox.evaluate('new Function("return 1")()');
    expect(r.error).toBe('runtime');
  });

  it('returns syntax error structured', () => {
    const r = sandbox.evaluate('1 + ');
    expect(r.error).toBe('syntax');
    expect(r.message).toBeTruthy();
  });

  it('returns runtime error structured for undefined identifiers', () => {
    const r = sandbox.evaluate('foo + 1');
    expect(r.error).toBe('runtime');
    expect(r.message).toMatch(/foo/);
  });

  it('times out on infinite loop', () => {
    // vm timeout works on synchronous expressions only; infinite loop is sync
    const r = sandbox.evaluate('(function(){ while(true); })()');
    expect(r.error).toBe('timeout');
  }, 200);

  it('captures duration in result', () => {
    const r = sandbox.evaluate('1 + 1');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('echoes expression in result', () => {
    const r = sandbox.evaluate('1 + 1');
    expect(r.expression).toBe('1 + 1');
  });
});
