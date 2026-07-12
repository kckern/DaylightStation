import { describe, it, expect } from 'vitest';
import { Response } from '#domains/trigger/Response.mjs';

describe('Response.script', () => {
  it('builds a script response', () => {
    expect(Response.script({ ref: 'bedtime', params: { x: 1 } })).toEqual({
      kind: 'script',
      ref: 'bedtime',
      params: { x: 1 },
    });
  });

  it('requires ref', () => {
    expect(() => Response.script({})).toThrow();
  });
});
