/**
 * Raster conversion: correctness AND cost (2026-08-22).
 *
 * The School receipt path prints `{type:'image'}`, so every result slip and
 * agenda goes through `#convertToMonochrome` → `#convertBitmapToEscPos`.
 *
 * Measured on real hardware before this was fixed: a 576×5000 receipt produced
 * 360,034 bytes, took 19.9 s, and spiked RSS to 698 MB (baseline 76 MB). The
 * cause was `commands = Buffer.concat([commands, Buffer.from([byte])])` inside
 * the per-byte loop — one full reallocation and copy of the growing buffer for
 * every single output byte, plus a nested JS array holding one number per
 * pixel.
 *
 * These tests pin the wire format exactly (so an optimisation cannot change
 * what the printer receives) and put a ceiling on the cost.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { createCanvas } from 'canvas';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';

const quietLogger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });

/** Writes a PNG whose left half is black and right half white, per row. */
function writeHalfBlackPng(width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width / 2, height);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'raster-')), `${width}x${height}.png`);
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
  return file;
}

/**
 * Writes an asymmetric 16x4 PNG: row 0 has ink in its left 8 dots only, rows
 * 1-3 are blank. Rotated 180° the ink must land in row 3, right 8 dots.
 */
function writeCornerPng() {
  const canvas = createCanvas(16, 4);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 16, 4);
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, 8, 1);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'raster-')), 'corner.png');
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
  return file;
}

/** Drives one image job through the adapter and returns the bytes written. */
async function bytesFor(imagePath, width, { upsideDown = false, align = 'left' } = {}) {
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
  await adapter.print({
    items: [{ type: 'image', path: imagePath, width, ...(align ? { align } : {}) }],
    footer: { autoCut: false },
  });
  return Buffer.concat(writes);
}

/** The `ESC a n` sent immediately before the raster block. */
function alignBeforeRaster(buf) {
  const at = buf.indexOf(Buffer.from([0x1d, 0x76, 0x30, 0x00]));
  return buf[at - 3] === 0x1b && buf[at - 2] === 0x61 ? buf[at - 1] : null;
}

/** Locates the `GS v 0` raster block and returns its header + payload. */
function rasterBlock(buf) {
  const at = buf.indexOf(Buffer.from([0x1d, 0x76, 0x30, 0x00]));
  expect(at).toBeGreaterThanOrEqual(0);
  const widthBytes = buf[at + 4] | (buf[at + 5] << 8);
  const height = buf[at + 6] | (buf[at + 7] << 8);
  const start = at + 8;
  return { widthBytes, height, payload: buf.subarray(start, start + widthBytes * height) };
}

describe('ESC/POS raster conversion', () => {
  it('emits a GS v 0 header matching the image geometry', async () => {
    const png = writeHalfBlackPng(16, 4);
    const { widthBytes, height, payload } = rasterBlock(await bytesFor(png, 16));

    expect(widthBytes).toBe(2);          // 16 dots / 8
    expect(height).toBe(4);
    expect(payload.length).toBe(8);      // 2 bytes * 4 rows
  });

  it('packs pixels MSB-first, one bit per dot', async () => {
    // Left half black => first byte all ones, second byte all zeros.
    const png = writeHalfBlackPng(16, 4);
    const { payload } = rasterBlock(await bytesFor(png, 16));

    for (let row = 0; row < 4; row++) {
      expect(payload[row * 2]).toBe(0xff);
      expect(payload[row * 2 + 1]).toBe(0x00);
    }
  });

  it('produces exactly widthBytes*height payload bytes for a tall image', async () => {
    const png = writeHalfBlackPng(576, 400);
    const { widthBytes, height, payload } = rasterBlock(await bytesFor(png, 576));

    expect(widthBytes).toBe(72);
    expect(height).toBe(400);
    expect(payload.length).toBe(72 * 400);
  });

  it('converts a receipt-sized raster without quadratic blow-up', async () => {
    // 576x2000 => 144,000 payload bytes. The old per-byte Buffer.concat made
    // this take many seconds and allocate hundreds of MB; a linear writer does
    // it comfortably inside this budget on any machine that can run the suite.
    const png = writeHalfBlackPng(576, 2000);

    const startedAt = Date.now();
    const { payload } = rasterBlock(await bytesFor(png, 576));
    const elapsed = Date.now() - startedAt;

    expect(payload.length).toBe(72 * 2000);
    expect(elapsed).toBeLessThan(5000);
  }, 30000);
});

// 2026-11-23: `ESC { 1` rotates characters only, never a `GS v 0` raster, so
// School receipts (one image item, never pre-flipped) printed upside down on
// the mounted printers. The adapter now rotates image items itself.
describe('ESC/POS raster on an upside-down printer', () => {
  it('sends the bitmap untouched when upsideDown is false', async () => {
    const { payload } = rasterBlock(await bytesFor(writeCornerPng(), 16, { upsideDown: false }));
    expect([...payload]).toEqual([0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  });

  it('rotates the bitmap 180° when upsideDown is true', async () => {
    const { widthBytes, height, payload } = rasterBlock(await bytesFor(writeCornerPng(), 16, { upsideDown: true }));
    expect(widthBytes).toBe(2);
    expect(height).toBe(4);
    expect([...payload]).toEqual([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff]);
  });

  it('mirrors left/right alignment upside down and leaves center alone', async () => {
    const png = writeCornerPng();
    expect(alignBeforeRaster(await bytesFor(png, 16, { upsideDown: false, align: 'left' }))).toBe(0x00);
    expect(alignBeforeRaster(await bytesFor(png, 16, { upsideDown: true, align: 'left' }))).toBe(0x02);
    expect(alignBeforeRaster(await bytesFor(png, 16, { upsideDown: true, align: 'right' }))).toBe(0x00);
    expect(alignBeforeRaster(await bytesFor(png, 16, { upsideDown: true, align: 'center' }))).toBe(0x01);
    // No align = the printer's default left, which reads as right once flipped.
    expect(alignBeforeRaster(await bytesFor(png, 16, { upsideDown: true, align: null }))).toBe(0x02);
    expect(alignBeforeRaster(await bytesFor(png, 16, { upsideDown: false, align: null }))).toBe(null);
  }, 30000); // each job waits out the adapter's post-write drain
});
