import { describe, expect, it, vi } from 'vitest';
import { createProjectionAdapter, projectForOptionalRenderer } from './createProjectionAdapter.js';

describe('optional renderer projections', () => {
  it('fails open without mutating authoritative state', () => {
    const state = { score: 4, nested: { safe: true } }; const diagnostics = vi.fn(); const adapter = createProjectionAdapter({ id: 'broken', project(value) { value.score = 99; throw new Error('renderer failed'); } });
    expect(projectForOptionalRenderer(adapter, state, { fallback: { score: 4 }, diagnostics })).toEqual({ score: 4 }); expect(state.score).toBe(4); expect(diagnostics).toHaveBeenCalledOnce();
  });
});
