import { describe, expect, it } from 'vitest';
import { glyphRows, loadSchoolCalcUiAssets } from './schoolcalc-ui-assets.mjs';
import { createSchoolCalcQrFrame } from './schoolcalc-qr.mjs';
import { createTi86ResultQrV5 } from './ti86-result-qr-v5.mjs';
import { decodeTi86Screen, renderTi86ScreenHybrid } from './ti86-screen-text.mjs';

const assets = loadSchoolCalcUiAssets();

describe('TI-86 mixed terminal screen decoder', () => {
  it('sweeps arbitrary x/y origins and detects normal and inverse SchoolCalc text', () => {
    const screen = Buffer.alloc(1024);
    drawGlyph(screen, 'compact-3x5', 'C', 17, 9);
    drawGlyph(screen, 'compact-3x5', 'A', 21, 9);
    drawGlyph(screen, 'compact-3x5', 'T', 25, 9);
    drawGlyph(screen, 'display-5x7', 'H', 101, 3);
    fill(screen, 60, 31, 30, 7);
    drawGlyph(screen, 'compact-3x5', 'F', 63, 32, false);
    drawGlyph(screen, 'compact-3x5', '1', 67, 32, false);

    const decoded = decodeTi86Screen(screen);
    expect(decoded.text.map(({ x, y, polarity, text }) => ({ x, y, polarity, text }))).toEqual(expect.arrayContaining([
      { x: 17, y: 9, polarity: 'dark-on-light', text: 'CAT' },
      { x: 101, y: 3, polarity: 'dark-on-light', text: 'H' },
      { x: 63, y: 32, polarity: 'light-on-dark', text: 'F1' },
    ]));
  });

  it('emits a chevron as a semantic symbol and leaves unknown pixels for Braille', () => {
    const screen = Buffer.alloc(1024);
    drawGlyph(screen, 'compact-3x5', 'A', 7, 12);
    setPixel(screen, 40, 11); setPixel(screen, 41, 12); setPixel(screen, 42, 13);
    setPixel(screen, 41, 14); setPixel(screen, 40, 15);
    setPixel(screen, 100, 50); setPixel(screen, 101, 51);

    const decoded = decodeTi86Screen(screen, { stripChrome: false });
    const aInk = [
      [8, 12], [7, 13], [9, 13], [7, 14], [8, 14], [9, 14], [7, 15], [9, 15], [7, 16], [9, 16],
    ];
    expect(aInk.every(([x, y]) => decoded.consumed[(y * 128) + x] === 1)).toBe(true);
    expect(decoded.symbols.map(({ symbol }) => symbol)).toContain('❯');
    expect(decoded.braille.replaceAll('\n', '')).not.toBe('');
    expect(renderTi86ScreenHybrid(screen, { stripChrome: false })).toContain('T (7,12)+/c:A');
  });

  it('prioritizes design-system icons and availability indicators over Braille', () => {
    const screen = Buffer.alloc(1024);
    drawIcon(screen, 'open', 40, 8);
    drawCircle(screen, 72, 29, false);
    drawCircle(screen, 90, 29, true);

    const decoded = decodeTi86Screen(screen, { stripChrome: false });
    expect(decoded.symbols.map(({ x, y, symbol }) => ({ x, y, symbol }))).toEqual(expect.arrayContaining([
      { x: 40, y: 8, symbol: '❯' },
      { x: 72, y: 29, symbol: '○' },
      { x: 90, y: 29, symbol: '●' },
    ]));
    expect(renderTi86ScreenHybrid(screen, { stripChrome: false })).toContain('S (40,8)+:❯ (72,29)+:○ (90,29)+:●');
  });

  it('recognizes both full-frame QR surfaces before sweeping glyphs', () => {
    const action = Buffer.from(createSchoolCalcQrFrame('sch:2K7QVM4X9HRJTBNP').bytes);
    const result = createTi86ResultQrV5(Buffer.from([0x53, 0x43, 0x52, 0x31])).frame;

    expect(renderTi86ScreenHybrid(action)).toContain('S (43,11)+:▦ QR V1/L 21×21 ×2');
    expect(renderTi86ScreenHybrid(result)).toContain('S (45,13)+:▦ QR V5/M 37×37');
    expect(decodeTi86Screen(action).text).toEqual([]);
    expect(decodeTi86Screen(result).text).toEqual([]);
  });

  it('keeps sparse result-QR rail text while reserving its module rectangle', () => {
    const result = Buffer.from(createTi86ResultQrV5(Buffer.from([0x53, 0x43, 0x52, 0x31])).frame);
    ['D', 'O', 'N', 'E'].forEach((character, index) => drawGlyph(result, 'compact-3x5', character, 5 + index * 4, 58));
    ['L', 'A', 'T', 'E', 'R'].forEach((character, index) => drawGlyph(result, 'compact-3x5', character, 104 + index * 4, 58));

    const decoded = decodeTi86Screen(result);
    expect(decoded.symbols.map(({ symbol }) => symbol)).toContain('▦ QR V5/M 37×37');
    expect(decoded.text.map(({ text }) => text)).toEqual(expect.arrayContaining(['DONE', 'LATER']));
  });
});

function drawGlyph(screen, fontId, character, x, y, set = true) {
  const font = assets.fonts.get(fontId);
  const rows = glyphRows(font, character);
  for (let offsetY = 0; offsetY < font.height; offsetY += 1) {
    for (let offsetX = 0; offsetX < font.width; offsetX += 1) {
      if (rows[offsetY] & (0x80 >>> offsetX)) setPixel(screen, x + offsetX, y + offsetY, set);
    }
  }
}

function fill(screen, x, y, width, height) {
  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    for (let offsetX = 0; offsetX < width; offsetX += 1) setPixel(screen, x + offsetX, y + offsetY);
  }
}

function drawIcon(screen, id, x, y) {
  const icon = assets.icons.find((candidate) => candidate.id === id);
  for (let offsetY = 0; offsetY < 7; offsetY += 1) {
    for (let offsetX = 0; offsetX < 7; offsetX += 1) {
      if (icon.bytes[offsetY] & (0x80 >>> offsetX)) setPixel(screen, x + offsetX, y + offsetY);
    }
  }
}

function drawCircle(screen, x, y, filled) {
  const rows = filled ? ['.██.', '████', '████', '.██.'] : ['.██.', '█..█', '█..█', '.██.'];
  rows.forEach((row, offsetY) => [...row].forEach((pixel, offsetX) => {
    if (pixel === '█') setPixel(screen, x + offsetX, y + offsetY);
  }));
}

function setPixel(screen, x, y, set = true) {
  const offset = (y * 16) + (x >>> 3);
  const bit = 0x80 >>> (x & 7);
  if (set) screen[offset] |= bit;
  else screen[offset] &= ~bit;
}
