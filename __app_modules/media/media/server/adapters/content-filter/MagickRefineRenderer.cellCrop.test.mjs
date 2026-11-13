import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { MagickRefineRenderer } from './MagickRefineRenderer.mjs';

// cellCrop runs in-process (2026-11-12: it was 4 ImageMagick processes per crop, ~3,000 a cue,
// and each process start blocked the refine loop ~45 ms). The magick binary here does not exist,
// so any spawn fails the test.
const renderer = new MagickRefineRenderer({ magick: '/nonexistent/magick' });
const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#808080', '#ffffff', '#000000'];

function gridPng(w, h, grid = 3) {
  const c = createCanvas(w, h); const g = c.getContext('2d');
  for (let r = 0; r < grid; r++) for (let k = 0; k < grid; k++) {
    g.fillStyle = COLORS[(r * grid + k) % COLORS.length];
    g.fillRect(Math.round((k * w) / grid), Math.round((r * h) / grid), Math.ceil(w / grid), Math.ceil(h / grid));
  }
  return c.toBuffer('image/png');
}
async function pixel(png, x, y) {
  const img = await loadImage(png); const c = createCanvas(img.width, img.height); const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
}

describe('MagickRefineRenderer.cellCrop (in-process)', () => {
  it('crops the cell with its pad: a large cell keeps its size', async () => {
    const png = await renderer.cellCrop(gridPng(1500, 900), { grid: 3, cell: 4, pad: 0.15 });
    const img = await loadImage(png);
    // cell 4 = row 1, col 1: 500x300 plus 15% of a cell each side -> 650x390
    expect([img.width, img.height]).toEqual([650, 390]);
    expect(await pixel(png, 325, 195)).toEqual([0, 255, 255]);
  });
  it('a small crop is padded white, centered, to at least 280 px each side', async () => {
    const png = await renderer.cellCrop(gridPng(720, 300), { grid: 3, cell: 0, pad: 0 });
    const img = await loadImage(png);
    expect([img.width, img.height]).toEqual([280, 280]);
    expect(await pixel(png, 140, 140)).toEqual([255, 0, 0]);
    expect(await pixel(png, 140, 5)).toEqual([255, 255, 255]);
  });
  it('a crop larger than 1568 px is shrunk to fit', async () => {
    const png = await renderer.cellCrop(gridPng(6000, 3000), { grid: 3, cell: 4, pad: 0 });
    const img = await loadImage(png);
    expect(img.width).toBe(1568);
    expect(img.height).toBe(784);
  });
  it('the pad stops at the frame edge', async () => {
    const png = await renderer.cellCrop(gridPng(1500, 900), { grid: 3, cell: 0, pad: 0.15 });
    const img = await loadImage(png);
    expect([img.width, img.height]).toEqual([575, 345]);
  });
});
