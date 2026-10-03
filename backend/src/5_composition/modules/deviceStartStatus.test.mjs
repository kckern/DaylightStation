import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDeviceStartStatusService, stopDeviceStartStatusService } from './deviceStartStatus.mjs';

const bus = () => ({ subscribePattern: vi.fn(() => () => {}), broadcast: vi.fn(), setStartStatusService: vi.fn() });
afterEach(() => stopDeviceStartStatusService());

describe('createDeviceStartStatusService', () => {
  it('reuses the service for the same bus and rebinds for a different bus', () => {
    const a = bus();
    const first = createDeviceStartStatusService({ eventBus: a, logger: { info() {}, warn() {} } }).startStatusService;
    expect(createDeviceStartStatusService({ eventBus: a }).startStatusService).toBe(first);
    const b = bus();
    const second = createDeviceStartStatusService({ eventBus: b, logger: { info() {}, warn() {} } }).startStatusService;
    expect(second).not.toBe(first);
    expect(b.setStartStatusService).toHaveBeenCalledWith(second);
  });
});
