import { describe, it, expect } from 'vitest';
import { EinkPanelService } from '#apps/eink/EinkPanelService.mjs';

// A stateful fake household store so we can assert persistence (read-modify-write).
function makeService() {
  const store = {}; // relativePath -> data
  const dataService = {
    household: {
      read: (p) => (p in store ? store[p] : null),
      write: (p, data) => { store[p] = data; return true; },
    },
  };
  const warnings = [];
  const svc = new EinkPanelService({
    baseUrl: 'http://test.local',
    dataService,
    logger: { info() {}, warn: (e, d) => warnings.push({ e, d }) },
  });
  return { svc, store, warnings };
}

const FULL = { bat: '4012', rssi: '-61', wake: 'timer', up: '1840', heap: '210000', psram: '5300000', rst: '4' };

describe('EinkPanelService telemetry', () => {
  it('records piggybacked /config params, parsed and timestamped', () => {
    const { svc } = makeService();
    const rec = svc.recordTelemetry('upstairs-eink', FULL);
    expect(rec.bat).toBe(4012);          // coerced to number
    expect(rec.rssi).toBe(-61);
    expect(rec.wake).toBe('timer');      // enum stays a string
    expect(rec.up).toBe(1840);
    expect(rec.heap).toBe(210000);
    expect(rec.psram).toBe(5300000);
    expect(rec.rst).toBe(4);
    expect(rec.at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  });

  it('computes a battery percent from millivolts (LiPo 3300=empty..4200=full)', () => {
    const { svc } = makeService();
    expect(svc.recordTelemetry('p', { bat: '4200' }).batteryPercent).toBe(100);
    expect(svc.recordTelemetry('p', { bat: '3300' }).batteryPercent).toBe(0);
    expect(svc.recordTelemetry('p', { bat: '3750' }).batteryPercent).toBe(50);
    // bat=0 means "not available" — no false reading
    expect(svc.recordTelemetry('p', { bat: '0', rssi: '-50' }).batteryPercent).toBe(null);
  });

  it('flags low battery and logs a warning', () => {
    const { svc, warnings } = makeService();
    const rec = svc.recordTelemetry('p', { bat: '3380' }); // ~9%
    expect(rec.low).toBe(true);
    expect(warnings.some((w) => w.e === 'eink.telemetry.low_battery')).toBe(true);
    expect(svc.recordTelemetry('p', { bat: '4012' }).low).toBe(false);
  });

  it('persists across instances (survives a redeploy)', () => {
    const { svc, store } = makeService();
    svc.recordTelemetry('upstairs-eink', FULL);
    // A fresh service sharing the same backing store reads the last reading.
    const dataService = { household: { read: (p) => (p in store ? store[p] : null), write: () => true } };
    const svc2 = new EinkPanelService({ dataService, logger: { info() {}, warn() {} } });
    expect(svc2.getTelemetry('upstairs-eink').bat).toBe(4012);
  });

  it('ignores a poll with NO telemetry params (does not clobber the last reading)', () => {
    const { svc } = makeService();
    svc.recordTelemetry('upstairs-eink', FULL);
    const res = svc.recordTelemetry('upstairs-eink', { foo: 'bar' }); // bare /config curl
    expect(res).toBe(null);
    expect(svc.getTelemetry('upstairs-eink').bat).toBe(4012); // preserved
  });

  it('getTelemetry returns null for an unknown panel', () => {
    const { svc } = makeService();
    expect(svc.getTelemetry('never-seen')).toBe(null);
  });
});
