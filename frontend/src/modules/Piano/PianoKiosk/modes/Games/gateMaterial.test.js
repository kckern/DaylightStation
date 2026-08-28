import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ instance: vi.fn() }));

vi.mock('../Exercises/pianoLearningApi.js', () => ({ pianoLearningApi: { instance: h.instance } }));

const { resolveGateMaterial } = await import('./gateMaterial.js');

describe('resolveGateMaterial', () => {
  beforeEach(() => { h.instance.mockReset(); });

  it('loads an exercise instance from the bank', async () => {
    const loaded = { id: 'scales/c-major@hands=1', title: 'C major' };
    h.instance.mockResolvedValue({ ok: true, status: 200, data: loaded });

    await expect(resolveGateMaterial({ kind: 'exercise', instanceId: 'scales/c-major@hands=1' }))
      .resolves.toEqual({ ok: true, kind: 'exercise', instance: loaded });
    expect(h.instance).toHaveBeenCalledWith('scales/c-major@hands=1');
  });

  it('reports an unavailable instance rather than throwing', async () => {
    h.instance.mockResolvedValue({ ok: false, status: 404, data: null });

    await expect(resolveGateMaterial({ kind: 'exercise', instanceId: 'nope@x=1' }))
      .resolves.toEqual({ ok: false, error: 'instance-unavailable' });
  });

  it('accepts score material as a known kind, and declines it for phase 1', async () => {
    // The seam exists from day one (D10). Phase 1 has no ghost/notation for a
    // score, so the caller skips it — it must not crash and must not be
    // mistaken for a typo'd kind.
    await expect(resolveGateMaterial({ kind: 'score', scoreId: 'bach/minuet' }))
      .resolves.toEqual({ ok: false, error: 'score-material-phase-2' });
    expect(h.instance).not.toHaveBeenCalled();
  });

  it('declines anything else, including nothing at all', async () => {
    await expect(resolveGateMaterial({ kind: 'chart' })).resolves.toEqual({ ok: false, error: 'unknown-material-kind' });
    await expect(resolveGateMaterial(null)).resolves.toEqual({ ok: false, error: 'unknown-material-kind' });
    await expect(resolveGateMaterial()).resolves.toEqual({ ok: false, error: 'unknown-material-kind' });
  });
});
