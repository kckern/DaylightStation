import { describe, expect, it, vi } from 'vitest';
import { ImportSchoolCalcResultQueue } from './ImportSchoolCalcResultQueue.mjs';

describe('ImportSchoolCalcResultQueue', () => {
  it('decodes through the enrolled family and imports records in durable queue order', async () => {
    const calls = [];
    const codec = {
      decodeResultQueue: vi.fn(() => ['record-4', 'record-5']),
      decodeResult: vi.fn((record) => ({ deviceId: 'DEV', sequence: Number(record.at(-1)) })),
    };
    const useCase = new ImportSchoolCalcResultQueue({
      devices: { getDevice: async () => ({ deviceId: 'DEV', platformId: 'future' }) },
      codecs: { get: (platformId) => { expect(platformId).toBe('future'); return codec; } },
      importResult: {
        execute: vi.fn(async ({ record, transport }) => {
          calls.push(record);
          return { deviceId: 'DEV', sequence: Number(record.at(-1)), status: record === 'record-4' ? 'accepted' : 'duplicate', transport };
        }),
      },
    });
    const result = await useCase.execute({ deviceId: 'DEV', record: 'queue' });
    expect(codec.decodeResult).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(['record-4', 'record-5']);
    expect(result).toMatchObject({ total: 2, accepted: 1, duplicate: 1, conflicts: 0 });
  });

  it('rejects a queued record belonging to another calculator before importing it', async () => {
    const importResult = { execute: vi.fn() };
    const useCase = new ImportSchoolCalcResultQueue({
      devices: { getDevice: async () => ({ platformId: 'future' }) },
      codecs: { get: () => ({
        decodeResultQueue: () => ['record'],
        decodeResult: () => ({ deviceId: 'OTHER' }),
      }) },
      importResult,
    });
    await expect(useCase.execute({ deviceId: 'DEV', record: 'queue' })).rejects.toThrow(/does not match endpoint/);
    expect(importResult.execute).not.toHaveBeenCalled();
  });

  it('preflights the complete batch so a late foreign record leaves earlier records untouched', async () => {
    const importResult = { execute: vi.fn() };
    const useCase = new ImportSchoolCalcResultQueue({
      devices: { getDevice: async () => ({ platformId: 'future' }) },
      codecs: { get: () => ({
        decodeResultQueue: () => ['record-1', 'record-2', 'record-3'],
        decodeResult: (record) => ({ deviceId: record === 'record-3' ? 'OTHER' : 'DEV' }),
      }) },
      importResult,
    });
    await expect(useCase.execute({ deviceId: 'DEV', record: 'queue' })).rejects.toThrow(/does not match endpoint/);
    expect(importResult.execute).not.toHaveBeenCalled();
  });
});
