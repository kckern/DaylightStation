import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VirtualThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/VirtualThermalPrinterAdapter.mjs';
import { ThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let captureDir, printer;

beforeEach(async () => {
  captureDir = await mkdtemp(path.join(os.tmpdir(), 'virt-thermal-'));
  printer = new VirtualThermalPrinterAdapter({ captureDir }, { logger: silent });
});

afterEach(async () => {
  await rm(captureDir, { recursive: true, force: true });
});

describe('surface parity with ThermalPrinterAdapter', () => {
  it('exposes every public method the real adapter does', () => {
    const surface = (proto) => Object.getOwnPropertyNames(proto)
      .filter((n) => n !== 'constructor' && typeof Object.getOwnPropertyDescriptor(proto, n).value === 'function')
      .sort();
    const real = surface(ThermalPrinterAdapter.prototype);
    const virt = new Set([
      ...surface(VirtualThermalPrinterAdapter.prototype),
      ...surface(Object.getPrototypeOf(VirtualThermalPrinterAdapter.prototype)),
    ]);
    expect(real.filter((m) => !virt.has(m))).toEqual([]);
  });

  it('is configured and reports a host and port like the real one', () => {
    expect(printer.isConfigured()).toBe(true);
    expect(typeof printer.getHost()).toBe('string');
    expect(printer.getPort()).toBe(9100);
  });

  it('builds the same job shapes via createReceiptPrint', () => {
    const job = printer.createReceiptPrint({ header: 'AGENDA', datetime: '2026-07-27 08:00', items: [{ name: 'Math' }], footer: 'Scan to begin' });
    expect(job.items[0]).toMatchObject({ type: 'text', content: 'AGENDA', align: 'center' });
    expect(job.footer).toEqual({ paddingLines: 3, autoCut: true });
    expect(job.items.some((i) => i.type === 'line')).toBe(true);
  });

  it('builds the same job shape via createImagePrint', () => {
    const job = printer.createImagePrint('/tmp/logo.png', { width: 320, height: 120 });
    expect(job.items[0]).toMatchObject({ type: 'image', path: '/tmp/logo.png', width: 320, height: 120, align: 'center' });
  });
});

describe('print — capture', () => {
  const agenda = {
    items: [
      { type: 'text', content: 'DAYLIGHT SCHOOL', align: 'center', size: { width: 2, height: 2 } },
      { type: 'line', width: 8 },
      { type: 'text', content: 'Math: fractions worksheet' },
      { type: 'space', lines: 1 },
      { type: 'barcode', content: 'sch:abc123', format: 'CODE128' },
      { type: 'text', content: 'Rescan when finished' },
      { type: 'cut' },
    ],
    footer: { paddingLines: 3, autoCut: true },
  };

  it('resolves true and writes {receiptId}.json + {receiptId}.txt', async () => {
    await expect(printer.print(agenda)).resolves.toBe(true);
    const files = (await readdir(captureDir)).sort();
    expect(files).toHaveLength(2);
    const id = printer.listReceipts()[0].receiptId;
    expect(files).toEqual([`${id}.json`, `${id}.txt`]);
  });

  it('the JSON capture holds the raw item list verbatim', async () => {
    await printer.print(agenda);
    const id = printer.listReceipts()[0].receiptId;
    const capture = JSON.parse(await readFile(path.join(captureDir, `${id}.json`), 'utf8'));
    expect(capture.items).toEqual(agenda.items);
    expect(capture.receiptId).toBe(id);
    expect(Date.parse(capture.at)).not.toBeNaN();
  });

  it('the transcript preserves authored order and text content', async () => {
    await printer.print(agenda);
    const transcript = await readFile(path.join(captureDir, `${printer.listReceipts()[0].receiptId}.txt`), 'utf8');
    const lines = transcript.split('\n');
    expect(lines).toContain('DAYLIGHT SCHOOL');
    expect(lines).toContain('Math: fractions worksheet');
    expect(lines).toContain('Rescan when finished');
    expect(lines.indexOf('DAYLIGHT SCHOOL')).toBeLessThan(lines.indexOf('Rescan when finished'));
  });

  it('renders a barcode as its code value on its own line', async () => {
    await printer.print(agenda);
    expect(printer.lastTranscript().split('\n')).toContain('sch:abc123');
  });

  it('carries the action token so a test can assert what the child was told', async () => {
    await printer.print(agenda);
    const t = printer.lastTranscript();
    expect(t).toContain('Rescan when finished');
    expect(t).toContain('sch:abc123');
  });

  it('keeps the transcript in authored order even with upsideDown reversal on the wire', async () => {
    const flipped = new VirtualThermalPrinterAdapter({ captureDir, upsideDown: true }, { logger: silent });
    await flipped.print(agenda);
    const lines = flipped.lastTranscript().split('\n');
    expect(lines.indexOf('DAYLIGHT SCHOOL')).toBeLessThan(lines.indexOf('Rescan when finished'));
  });

  it('renders line items as their repeated rule character', async () => {
    await printer.print({ items: [{ type: 'line', content: '=', width: 5 }] });
    expect(printer.lastTranscript().split('\n')).toContain('=====');
  });

  it('renders space items as blank lines and omits cut / feedButton', async () => {
    await printer.print({ items: [{ type: 'text', content: 'A' }, { type: 'space', lines: 2 }, { type: 'cut' }, { type: 'feedButton', enabled: true }, { type: 'text', content: 'B' }] });
    expect(printer.lastTranscript()).toBe('A\n\n\nB');
  });

  it('records image dimensions, never pixels', async () => {
    await printer.print({ items: [{ type: 'image', path: '/tmp/sticker.png', width: 384, height: 128 }] });
    const receipt = printer.listReceipts()[0];
    expect(receipt.images).toEqual([{ index: 0, path: '/tmp/sticker.png', width: 384, height: 128 }]);
    expect(printer.lastTranscript()).not.toContain('sticker');
  });

  it('resolves false for a job with no items array, like the real adapter', async () => {
    await expect(printer.print({})).resolves.toBe(false);
    await expect(printer.print(null)).resolves.toBe(false);
    expect(printer.listReceipts()).toEqual([]);
  });
});

describe('listReceipts / readReceipt / lastTranscript', () => {
  it('lists receipts in submission order', async () => {
    await printer.print({ items: [{ type: 'text', content: 'one' }] });
    await printer.print({ items: [{ type: 'text', content: 'two' }] });
    expect(printer.listReceipts().map((r) => r.transcript)).toEqual(['one', 'two']);
  });

  it('readReceipt returns the full capture for an id', async () => {
    await printer.print({ items: [{ type: 'text', content: 'hello' }] });
    const { receiptId } = printer.listReceipts()[0];
    expect(printer.readReceipt(receiptId).transcript).toBe('hello');
  });

  it('readReceipt returns null for an unknown id', () => {
    expect(printer.readReceipt('receipt_9999')).toBe(null);
  });

  it('lastTranscript returns null before anything is printed', () => {
    expect(printer.lastTranscript()).toBe(null);
  });
});

describe('print queue serialization', () => {
  it('never interleaves concurrent jobs and preserves submission order', async () => {
    const slow = new VirtualThermalPrinterAdapter({ captureDir, jobDelayMs: 20 }, { logger: silent });
    const started = Date.now();
    await Promise.all(['a', 'b', 'c', 'd'].map((c) => slow.print({ items: [{ type: 'text', content: c }] })));
    // Serialized: 4 jobs x 20ms cannot finish in under 3 delays' worth of time.
    expect(Date.now() - started).toBeGreaterThanOrEqual(60);
    expect(slow.listReceipts().map((r) => r.transcript)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('ping / getStatus — healthy', () => {
  it('ping returns the real adapter success shape', async () => {
    const res = await printer.ping();
    expect(res).toMatchObject({ success: true, configured: true, host: printer.getHost(), port: 9100 });
    expect(typeof res.latency).toBe('number');
  });

  it('getStatus reports online with paper', async () => {
    const status = await printer.getStatus();
    expect(status).toMatchObject({ success: true, online: true, paperPresent: true, coverOpen: false, cutterOk: true });
    expect(status.errors).toEqual([]);
  });
});

describe('fault: offline', () => {
  beforeEach(() => printer.setFault('offline'));

  it('print resolves false rather than rejecting', async () => {
    await expect(printer.print({ items: [{ type: 'text', content: 'x' }] })).resolves.toBe(false);
  });

  it('captures nothing when the job could not be sent', async () => {
    await printer.print({ items: [{ type: 'text', content: 'x' }] });
    expect(printer.listReceipts()).toEqual([]);
    expect(await readdir(captureDir)).toEqual([]);
  });

  it('ping reports the connection failure', async () => {
    const res = await printer.ping();
    expect(res).toMatchObject({ success: false, configured: true });
    expect(res.error).toBeTruthy();
  });

  it('getStatus reports failure without throwing', async () => {
    await expect(printer.getStatus()).resolves.toMatchObject({ success: false, error: 'Connection failed' });
  });

  it('clearing the fault restores printing', async () => {
    printer.setFault(null);
    await expect(printer.print({ items: [{ type: 'text', content: 'x' }] })).resolves.toBe(true);
  });
});

describe('fault: jam — out of paper, still reachable', () => {
  beforeEach(() => printer.setFault('jam'));

  it('accepts the job — the printer takes the bytes either way', async () => {
    await expect(printer.print({ items: [{ type: 'text', content: 'x' }] })).resolves.toBe(true);
  });

  it('surfaces the fault through getStatus', async () => {
    const status = await printer.getStatus();
    expect(status.success).toBe(true);
    expect(status.paperPresent).toBe(false);
    expect(status.errors).toContain('auto_recoverable_error');
  });

  it('ping still succeeds', async () => {
    expect((await printer.ping()).success).toBe(true);
  });
});

describe('setFault validation', () => {
  it('rejects an unknown fault name', () => {
    expect(() => printer.setFault('smoking')).toThrow(/offline/);
    expect(printer.getFault()).toBe(null);
  });
});
