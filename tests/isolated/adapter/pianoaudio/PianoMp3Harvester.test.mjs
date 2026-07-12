// tests/isolated/adapter/pianoaudio/PianoMp3Harvester.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { PianoMp3Harvester } from '#adapters/harvester/other/PianoMp3Harvester.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('PianoMp3Harvester', () => {
  it('exposes the scheduler contract (serviceId, category, status, params)', () => {
    const h = new PianoMp3Harvester({ convertUseCase: { execute: vi.fn() }, logger: silent });
    expect(h.serviceId).toBe('piano-mp3');
    expect(h.category).toBe('other');
    expect(h.getStatus()).toEqual({ state: 'closed', failures: 0, lastFailure: null, cooldownUntil: null });
    expect(h.getParams()).toEqual([]);
  });

  it('delegates harvest() to the use case and returns its result', async () => {
    const convertUseCase = { execute: vi.fn(async () => ({ count: 7, status: 'success' })) };
    const h = new PianoMp3Harvester({ convertUseCase, logger: silent });

    const result = await h.harvest('kckern', {});

    expect(convertUseCase.execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ count: 7, status: 'success' });
  });

  it('throws if constructed without a use case', () => {
    expect(() => new PianoMp3Harvester({ logger: silent })).toThrow();
  });
});
