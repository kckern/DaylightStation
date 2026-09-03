import { describe, expect, it, vi } from 'vitest';
import { PressureMatAdapter } from './PressureMatAdapter.mjs';

function harness(config = {}, options = {}) {
  let ingest;
  const broadcasts = [];
  const eventBus = {
    onClientMessage(fn) { ingest = fn; },
    broadcast(topic, payload) { broadcasts.push({ topic, payload }); return options.delivered ?? 1; },
    subscribe() { return () => {}; },
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const adapter = new PressureMatAdapter({ eventBus, config, logger, now: () => 1_800_000, ...options }).start();
  return { adapter, emit: (message) => ingest('esp-1', message), broadcasts, logger };
}

describe('PressureMatAdapter', () => {
  it('normalizes readings, broadcasts them, and keeps status', () => {
    const h = harness({ pressure_mats: { mat1: { label: 'Step mat', topic: 'fitness-floor' } } });
    h.emit({ source: 'pressure-mat-relay', type: 'reading', id: 'mat1', voltage: 2.31, delta_v: .42, gradient_vps: -.8, occupied: true, steps: 3, ts: 1234 });
    expect(h.broadcasts[0]).toMatchObject({ topic: 'fitness-floor', payload: { id: 'mat1', voltage: 2.31, deltaV: .42, occupied: true } });
    expect(h.adapter.getStatus('mat1')).toMatchObject({ label: 'Step mat', online: true, latest: { steps: 3 } });
  });

  it('rejects malformed device frames', () => {
    const h = harness();
    h.emit({ source: 'pressure-mat-relay', type: 'reading', id: 'mat1', voltage: 'bad', delta_v: 0, gradient_vps: 0 });
    h.emit({ source: 'pressure-mat-relay', type: 'presence', event: 'maybe', id: 'mat1', voltage: 2, delta_v: 0, gradient_vps: 0 });
    expect(h.broadcasts).toHaveLength(0);
    expect(h.logger.warn).toHaveBeenCalledTimes(2);
  });

  it('forwards stomp classification independently from the step count', () => {
    const h = harness();
    h.emit({ source: 'pressure-mat-relay', type: 'presence', event: 'stomped', id: 'mat1', voltage: 1.8, delta_v: .9, gradient_vps: -2, occupied: true, steps: 4, stomps: 2 });
    expect(h.broadcasts[0].payload).toMatchObject({ event: 'stomped', steps: 4, stomps: 2 });
  });

  it('normalizes a firmware v2 completed-press summary', () => {
    const h = harness();
    h.emit({
      source: 'pressure-mat-relay', protocol_version: 2, type: 'presence', event: 'released', id: 'mat1',
      voltage: 3.1, rest_voltage: 3.2, delta_v: 0, gradient_vps: .7,
      peak_delta_v: .83, peak_gradient_vps: 2.4, press_duration_ms: 780,
      classified_stomp: true, occupied: false, steps: 4, stomps: 2, ts: 1500,
    });
    expect(h.broadcasts[0].payload).toMatchObject({
      protocolVersion: 2,
      event: 'released',
      restVoltage: 3.2,
      peakDeltaV: .83,
      peakGradientVps: 2.4,
      pressDurationMs: 780,
      classifiedStomp: true,
    });
  });

  it('reads live status only from the configured device host', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const h = harness({ pressure_mats: { mat1: { device: { host: 'mat1.local' } } } }, { fetchImpl });
    await h.adapter.fetchDeviceStatus('mat1');
    expect(String(fetchImpl.mock.calls[0][0])).toBe('http://mat1.local/status');
    await expect(h.adapter.recalibrate('unknown')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('delivers maintenance commands over the device WebSocket topic', async () => {
    const h = harness({ pressure_mats: { mat1: {} } });
    await expect(h.adapter.setThreshold('mat1', { delta: .12, gradient: .08, stompDelta: .48 })).resolves.toMatchObject({ ok: true, delivered: 1 });
    expect(h.broadcasts.at(-1)).toEqual({
      topic: 'pressure-mat-control:mat1',
      payload: { source: 'pressure-mat-api', id: 'mat1', action: 'threshold', delta: .12, gradient: .08, stompDelta: .48 },
    });
  });

  it('reports an offline device when no WebSocket client receives a command', async () => {
    const h = harness({ pressure_mats: { mat1: {} } }, { delivered: 0 });
    await expect(h.adapter.reboot('mat1')).rejects.toMatchObject({ status: 503, code: 'DEVICE_OFFLINE' });
  });
});
