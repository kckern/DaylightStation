import { describe, it, expect, beforeEach } from 'vitest';
import { MedicalReadingsService } from './MedicalReadingsService.mjs';

describe('MedicalReadingsService', () => {
  let svc, saved;
  beforeEach(() => {
    saved = { readings: [] };
    svc = new MedicalReadingsService({
      store: {
        load: async () => saved,
        save: async (doc) => { saved = doc; },
      },
      createId: (() => { let n = 0; return () => `r-${n++}`; })(),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
  });

  it('adds a BP reading with value2', async () => {
    const r = await svc.add({ metric: 'bp', value: 120, value2: 80, unit: 'mmHg', date: '2026-09-02' }, 'u');
    expect(r.id).toBe('r-0');
    expect(saved.readings).toHaveLength(1);
  });

  it('rejects non-finite values without coercion', async () => {
    await expect(svc.add({ metric: 'bp', value: '120', unit: 'mmHg', date: '2026-09-02' }, 'u'))
      .rejects.toThrow(/INVALID_READING/);
    await expect(svc.add({ metric: 'glucose', value: NaN, unit: 'mg/dL', date: '2026-09-02' }, 'u'))
      .rejects.toThrow(/INVALID_READING/);
  });

  it('rejects malformed dates and empty metrics', async () => {
    await expect(svc.add({ metric: '', value: 1, unit: 'x', date: '2026-09-02' }, 'u')).rejects.toThrow(/INVALID_READING/);
    await expect(svc.add({ metric: 'bp', value: 1, unit: 'x', date: '9/2/26' }, 'u')).rejects.toThrow(/INVALID_READING/);
  });

  it('groups by metric with latest first', async () => {
    await svc.add({ metric: 'bp', value: 120, value2: 80, unit: 'mmHg', date: '2026-09-01' }, 'u');
    await svc.add({ metric: 'bp', value: 118, value2: 78, unit: 'mmHg', date: '2026-09-02' }, 'u');
    await svc.add({ metric: 'glucose', value: 92, unit: 'mg/dL', date: '2026-09-02' }, 'u');
    const { metrics } = await svc.listGrouped('u');
    expect(metrics).toHaveLength(2);
    const bp = metrics.find((m) => m.metric === 'bp');
    expect(bp.latest.value).toBe(118);
    expect(bp.readings[0].date).toBe('2026-09-02');
  });

  it('removes by id', async () => {
    const r = await svc.add({ metric: 'bp', value: 120, value2: 80, unit: 'mmHg', date: '2026-09-02' }, 'u');
    await svc.remove(r.id, 'u');
    expect(saved.readings).toHaveLength(0);
  });

  it('preserves each reading unit in a mixed-unit history', async () => {
    await svc.add({ metric: 'glucose', value: 90, unit: 'mg/dL', date: '2026-09-01' }, 'u');
    await svc.add({ metric: 'glucose', value: 5, unit: 'mmol/L', date: '2026-09-02' }, 'u');
    const { metrics } = await svc.listGrouped('u');
    expect(metrics[0].readings.map(reading => [reading.value, reading.unit])).toEqual([[5, 'mmol/L'], [90, 'mg/dL']]);
  });

  it('rejects impossible calendar dates and unsupported metric units', async () => {
    await expect(svc.add({ metric: 'glucose', value: 90, unit: 'mg/dL', date: '2026-02-31' }, 'u')).rejects.toThrow();
    await expect(svc.add({ metric: 'glucose', value: 90, unit: 'cups', date: '2026-09-02' }, 'u')).rejects.toThrow();
  });
});
