import { describe, it, expect, vi } from 'vitest';
import { RoutedThermalPrinter } from '#adapters/hardware/thermal-printer/RoutedThermalPrinter.mjs';
import { ThermalPrinterRegistry } from '#adapters/hardware/thermal-printer/ThermalPrinterRegistry.mjs';

const SENT = { dispatched: true, verified: true, verification: 'verified', faults: null, printerState: null };
const UNREACHABLE = { dispatched: false, verified: false, verification: 'unreadable', faults: null, printerState: null };
const PAPER_OUT = { dispatched: false, verified: false, verification: 'faulted', faults: ['paper-out'], printerState: null };
const SENT_UNCONFIRMED = { dispatched: true, verified: false, verification: 'unreadable', faults: null, printerState: null };

function fakePrinter(host, outcomes) {
  const queue = [...outcomes];
  return {
    host,
    print: vi.fn(async () => queue.shift() ?? SENT),
    getStatus: vi.fn(async () => ({ success: true, online: true })),
    ping: vi.fn(async () => ({ success: true })),
    isConfigured: () => true,
    getHost: () => host,
    getPort: () => 9100,
    createTextPrint: vi.fn((text) => ({ type: 'text', text })),
  };
}

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const routed = (chain, opts = {}) => new RoutedThermalPrinter({ name: chain[0].name, chain, logger: quiet, ...opts });

describe('RoutedThermalPrinter', () => {
  it('prints on the first printer when it takes the job', async () => {
    const down = fakePrinter('10.0.0.50', [SENT]);
    const up = fakePrinter('10.0.0.137', []);
    const result = await routed([{ name: 'downstairs', adapter: down }, { name: 'upstairs', adapter: up }]).print({ job: 1 });
    expect(result).toMatchObject({ dispatched: true, printedOn: 'downstairs', failedOver: false });
    expect(up.print).not.toHaveBeenCalled();
  });

  it('moves a job that never left to the next printer, and says where it printed', async () => {
    const down = fakePrinter('10.0.0.50', [UNREACHABLE]);
    const up = fakePrinter('10.0.0.137', [SENT]);
    const result = await routed([{ name: 'downstairs', adapter: down }, { name: 'upstairs', adapter: up }]).print({ job: 1 });
    expect(result).toMatchObject({ dispatched: true, printedOn: 'upstairs', failedOver: true, tried: ['downstairs', 'upstairs'] });
  });

  it('moves a job the printer refused at preflight (paper out)', async () => {
    const down = fakePrinter('10.0.0.50', [PAPER_OUT]);
    const up = fakePrinter('10.0.0.137', [SENT]);
    const result = await routed([{ name: 'downstairs', adapter: down }, { name: 'upstairs', adapter: up }]).print({ job: 1 });
    expect(result.printedOn).toBe('upstairs');
  });

  it('never resends a job that was sent, even unconfirmed: no duplicate prints', async () => {
    const down = fakePrinter('10.0.0.50', [SENT_UNCONFIRMED]);
    const up = fakePrinter('10.0.0.137', []);
    const result = await routed([{ name: 'downstairs', adapter: down }, { name: 'upstairs', adapter: up }]).print({ job: 1 });
    expect(result).toMatchObject({ dispatched: true, printedOn: 'downstairs', failedOver: false });
    expect(up.print).not.toHaveBeenCalled();
  });

  it('skips a printer marked down for a while, then tries it again', async () => {
    let now = 0;
    const down = fakePrinter('10.0.0.50', [UNREACHABLE, SENT]);
    const up = fakePrinter('10.0.0.137', [SENT, SENT]);
    const printer = routed([{ name: 'downstairs', adapter: down }, { name: 'upstairs', adapter: up }], { downForMs: 60_000, clock: () => now });
    await printer.print({ job: 1 });
    now = 30_000;
    const second = await printer.print({ job: 2 });
    expect(second).toMatchObject({ printedOn: 'upstairs', tried: ['upstairs'] });
    expect(down.print).toHaveBeenCalledTimes(1);
    now = 61_000;
    const third = await printer.print({ job: 3 });
    expect(third.printedOn).toBe('downstairs');
  });

  it('when every printer is down, still tries them all in order and reports the last answer', async () => {
    const down = fakePrinter('10.0.0.50', [UNREACHABLE]);
    const up = fakePrinter('10.0.0.137', [UNREACHABLE]);
    const result = await routed([{ name: 'downstairs', adapter: down }, { name: 'upstairs', adapter: up }]).print({ job: 1 });
    expect(result).toMatchObject({ dispatched: false, printedOn: null, tried: ['downstairs', 'upstairs'] });
  });

  it('builds jobs with the primary printer and answers host questions for it', () => {
    const down = fakePrinter('10.0.0.50', []);
    const printer = routed([{ name: 'downstairs', adapter: down }, { name: 'upstairs', adapter: fakePrinter('10.0.0.137', []) }]);
    expect(printer.createTextPrint('hi')).toEqual({ type: 'text', text: 'hi' });
    expect(printer.getHost()).toBe('10.0.0.50');
    expect(printer.isConfigured()).toBe(true);
  });
});

describe('ThermalPrinterRegistry routes', () => {
  it('resolves a printer with a fallback to its routed form, and one without to itself', async () => {
    const registry = new ThermalPrinterRegistry({ logger: quiet });
    const down = fakePrinter('10.0.0.50', [UNREACHABLE]);
    const up = fakePrinter('10.0.0.137', [SENT]);
    registry.register('downstairs', down, { isDefault: true, fallback: ['upstairs'] });
    registry.register('upstairs', up);
    expect(registry.resolve('upstairs')).toBe(up);
    const result = await registry.resolve().print({ job: 1 });
    expect(result.printedOn).toBe('upstairs');
    expect(registry.resolve('downstairs')).toBe(registry.resolve());
  });

  it('ignores a fallback that names no registered printer', async () => {
    const registry = new ThermalPrinterRegistry({ logger: quiet });
    const down = fakePrinter('10.0.0.50', [SENT]);
    registry.register('downstairs', down, { fallback: ['attic'] });
    expect(registry.resolve('downstairs')).toBe(down);
  });
});
