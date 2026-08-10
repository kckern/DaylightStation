import { afterEach, describe, expect, it, vi } from 'vitest';
import { mintTakeId, takeContentHash } from './producerIdentity.js';

afterEach(() => vi.unstubAllGlobals());

describe('Producer identities', () => {
  it('mints distinct, namespaced take ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => mintTakeId('take')));
    expect(ids.size).toBe(100);
    expect([...ids].every((id) => id.startsWith('take-'))).toBe(true);
  });

  it('hashes musical content deterministically and detects a changed note', async () => {
    const a = { notes: [{ midi: 60, ticks: 0, durationTicks: 480 }], ppq: 480, lengthBars: 1 };
    const reordered = { lengthBars: 1, ppq: 480, notes: [{ durationTicks: 480, ticks: 0, midi: 60 }] };
    const changed = { ...a, notes: [{ ...a.notes[0], midi: 61 }] };
    expect(await takeContentHash(a, 'melody')).toBe(await takeContentHash(reordered, 'melody'));
    expect(await takeContentHash(a, 'melody')).not.toBe(await takeContentHash(changed, 'melody'));
  });

  it('produces the same SHA-256 when secure-context Web Crypto is unavailable', async () => {
    const take = { notes: [{ midi: 60, ticks: 0, durationTicks: 480 }], ppq: 480, lengthBars: 1 };
    const native = await takeContentHash(take, 'melody');
    vi.stubGlobal('crypto', {});
    const fallback = await takeContentHash(take, 'melody');
    expect(fallback).toBe(native);
    expect(fallback).toMatch(/^[a-f0-9]{64}$/);
  });
});
