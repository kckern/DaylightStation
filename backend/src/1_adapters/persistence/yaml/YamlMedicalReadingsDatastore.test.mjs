import { describe, it, expect } from 'vitest';
import { YamlMedicalReadingsDatastore } from './YamlMedicalReadingsDatastore.mjs';

const READING = { id: 'r1', metric: 'bp', value: 120, value2: 80, unit: 'mmHg', date: '2026-09-02', note: '' };

describe('YamlMedicalReadingsDatastore.save', () => {
  it('resolves when dataService.user.write succeeds (returns true)', async () => {
    const store = new YamlMedicalReadingsDatastore({
      dataService: { user: { read: () => ({ readings: [] }), write: () => true } },
    });
    await expect(store.save({ readings: [READING] }, 'kckern')).resolves.toBeUndefined();
  });

  it('resolves when dataService.user.write returns undefined (legacy/void success)', async () => {
    const store = new YamlMedicalReadingsDatastore({
      dataService: { user: { read: () => ({ readings: [] }), write: () => undefined } },
    });
    await expect(store.save({ readings: [READING] }, 'kckern')).resolves.toBeUndefined();
  });

  it('rejects with a coded MEDICAL_WRITE_FAILED error when write returns false', async () => {
    const store = new YamlMedicalReadingsDatastore({
      dataService: { user: { read: () => ({ readings: [] }), write: () => false } },
    });
    await expect(store.save({ readings: [READING] }, 'kckern')).rejects.toThrow(/MEDICAL_WRITE_FAILED/);
    try {
      await store.save({ readings: [READING] }, 'kckern');
      throw new Error('expected save to reject');
    } catch (err) {
      expect(err.code).toBe('MEDICAL_WRITE_FAILED');
      expect(err.message).toContain('apps/health/medical');
      expect(err.message).toContain('kckern');
    }
  });
});

describe('YamlMedicalReadingsDatastore.load', () => {
  it('returns readings when data exists', async () => {
    const store = new YamlMedicalReadingsDatastore({
      dataService: { user: { read: () => ({ readings: [READING] }) } },
    });
    const doc = await store.load('kckern');
    expect(doc.readings).toHaveLength(1);
    expect(doc.readings[0].id).toBe('r1');
  });

  it('returns empty readings when data is null or missing', async () => {
    const store = new YamlMedicalReadingsDatastore({
      dataService: { user: { read: () => null } },
    });
    const doc = await store.load('kckern');
    expect(doc.readings).toHaveLength(0);
  });
});
