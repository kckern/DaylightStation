/**
 * Upside-down text order (2026-11-23).
 *
 * An upside-down printer gets the job's items in reverse order so the paper
 * reads top-to-bottom once turned round. A text item with several lines (an
 * embedded `\n`, or a line the printer wrapped itself) used to come out with
 * those lines reversed. The adapter now splits text into one item per printed
 * line before reversing.
 */
import { describe, it, expect, jest } from '@jest/globals';
import {
  ThermalPrinterAdapter,
  splitTextIntoPrintedLines,
} from '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';

const quietLogger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });

describe('splitTextIntoPrintedLines', () => {
  it('splits embedded newlines into one item each, keeping styling', () => {
    const items = splitTextIntoPrintedLines([
      { type: 'text', content: 'one\ntwo\nthree', style: { bold: true }, align: 'center' },
    ]);
    expect(items.map(i => i.content)).toEqual(['one', 'two', 'three']);
    for (const item of items) {
      expect(item.style).toEqual({ bold: true });
      expect(item.align).toBe('center');
    }
  });

  it('keeps a blank line as a printable space', () => {
    const items = splitTextIntoPrintedLines([{ type: 'text', content: 'a\n\nb' }]);
    expect(items.map(i => i.content)).toEqual(['a', ' ', 'b']);
  });

  it('word-wraps at 48 columns for font A', () => {
    const words = Array.from({ length: 12 }, (_, i) => `word${i}`).join(' '); // 71 chars
    const items = splitTextIntoPrintedLines([{ type: 'text', content: words }]);
    expect(items.length).toBe(2);
    for (const item of items) expect(item.content.length).toBeLessThanOrEqual(48);
    expect(items.map(i => i.content).join(' ')).toBe(words);
  });

  it('narrows the line for double-width text and widens it for font B', () => {
    const line = 'x'.repeat(30);
    expect(splitTextIntoPrintedLines([{ type: 'text', content: line, size: { width: 2 } }]).length).toBe(2); // 24 cols
    expect(splitTextIntoPrintedLines([{ type: 'text', content: 'y'.repeat(60), font: 'b' }]).length).toBe(1); // 64 cols
  });

  it('hard-breaks a word longer than the line', () => {
    const items = splitTextIntoPrintedLines([{ type: 'text', content: 'z'.repeat(100) }]);
    expect(items.map(i => i.content.length)).toEqual([48, 48, 4]);
  });

  it('passes non-text and single-line items through unchanged', () => {
    const barcode = { type: 'barcode', content: '123' };
    const short = { type: 'text', content: 'short' };
    const out = splitTextIntoPrintedLines([barcode, short]);
    expect(out[0]).toBe(barcode);
    expect(out[1]).toBe(short);
  });
});

/** Drives one text job through the adapter and returns the bytes written. */
async function bytesFor(items, upsideDown) {
  const writes = [];
  const transport = {
    open(cb) { setImmediate(() => cb(null)); return this; },
    write(data, cb) { writes.push(data); setImmediate(() => cb(null)); return this; },
    close() { return this; },
  };
  const adapter = new ThermalPrinterAdapter(
    { host: '10.20.30.50', port: 9100, timeout: 5000, upsideDown },
    { logger: quietLogger(), createTransport: () => transport },
  );
  await adapter.print({ items, footer: { autoCut: false } });
  return Buffer.concat(writes).toString('latin1');
}

describe('upside-down text on the wire', () => {
  it('sends the lines of one multi-line item last-first when upside down', async () => {
    const wire = await bytesFor([{ type: 'text', content: 'FIRST\nSECOND\nTHIRD' }], true);
    const at = word => wire.indexOf(word);
    expect(at('THIRD')).toBeLessThan(at('SECOND'));
    expect(at('SECOND')).toBeLessThan(at('FIRST'));
  }, 30000);

  it('leaves a right-way-up printer sending the item as written', async () => {
    const wire = await bytesFor([{ type: 'text', content: 'FIRST\nSECOND\nTHIRD' }], false);
    expect(wire).toContain('FIRST\nSECOND\nTHIRD\n');
  }, 30000);
});
