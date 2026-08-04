#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createCanvas } from 'canvas';
import { lintSchoolCalcDesignSystem } from './lib/schoolcalc-design-system.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = path.resolve(HERE, '../gui/screens.yml');
const DEFAULT_OUTPUT = path.resolve(HERE, '../docs/gui');
const DEFAULT_DESIGN_SOURCE = path.resolve(HERE, '../gui/design-system.yml');
const DEFAULT_TYPE_SOURCE = path.resolve(HERE, '../gui/type.yml');
const DEFAULT_ICON_SOURCE = path.resolve(HERE, '../gui/icons.yml');
const DISPLAY_WIDTH = 128;
const DISPLAY_HEIGHT = 64;

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const sourcePath = path.resolve(valueAfter('--source', DEFAULT_SOURCE));
const outputDir = path.resolve(valueAfter('--output', DEFAULT_OUTPUT));
const designSourcePath = path.resolve(valueAfter('--design-source', DEFAULT_DESIGN_SOURCE));
const typeSourcePath = path.resolve(valueAfter('--type-source', DEFAULT_TYPE_SOURCE));
const iconSourcePath = path.resolve(valueAfter('--icon-source', DEFAULT_ICON_SOURCE));
const previewScale = Number(valueAfter('--preview-scale', '4'));
if (!Number.isInteger(previewScale) || previewScale < 1 || previewScale > 16) {
  throw new Error('--preview-scale must be an integer from 1 to 16');
}

const spec = yaml.load(fs.readFileSync(sourcePath, 'utf8'));
const designSpec = yaml.load(fs.readFileSync(designSourcePath, 'utf8'));
const typeSpec = yaml.load(fs.readFileSync(typeSourcePath, 'utf8'));
const iconSpec = yaml.load(fs.readFileSync(iconSourcePath, 'utf8'));
validateSpec(spec);
validateTypeSpec(typeSpec);
validateIconSpec(iconSpec);
const designLint = lintSchoolCalcDesignSystem({
  design: designSpec,
  screens: spec,
  type: typeSpec,
  icons: iconSpec,
});
if (!designLint.ok) {
  throw new Error(`SchoolCalc design-system lint failed:\n${designLint.errors.map((error) => `- ${error}`).join('\n')}`);
}
fs.mkdirSync(outputDir, { recursive: true });

const rendered = spec.screens.map((screen) => ({
  screen,
  canvas: renderScreen(spec, screen, previewScale),
}));

for (const { screen, canvas } of rendered) {
  fs.writeFileSync(path.join(outputDir, `${screen.id}.png`), canvas.toBuffer('image/png'));
}

const sheet = renderSheet(rendered, spec, previewScale);
fs.writeFileSync(path.join(outputDir, 'schoolcalc-gui-sheet.png'), sheet.toBuffer('image/png'));
fs.writeFileSync(
  path.join(outputDir, 'schoolcalc-type-sheet.png'),
  renderTypeSheet(typeSpec, previewScale).toBuffer('image/png'),
);
fs.writeFileSync(
  path.join(outputDir, 'schoolcalc-icon-sheet.png'),
  renderIconSheet(iconSpec, previewScale).toBuffer('image/png'),
);
console.log(
  `Rendered ${rendered.length} lint-clean SchoolCalc screens plus type/icon sheets to ${outputDir}`,
);

function validateSpec(value) {
  if (value?.schema !== 'schoolcalc.gui/v1') throw new Error('GUI schema must be schoolcalc.gui/v1');
  if (value.screen_width !== DISPLAY_WIDTH || value.screen_height !== DISPLAY_HEIGHT) {
    throw new Error(`SchoolCalc GUI sources must cover the complete ${DISPLAY_WIDTH}x${DISPLAY_HEIGHT} TI-86 framebuffer`);
  }
  if (value.pixel_scale !== 1) {
    throw new Error('pixel_scale must be 1: every YAML block represents one physical LCD pixel');
  }
  const gridWidth = DISPLAY_WIDTH;
  const gridHeight = DISPLAY_HEIGHT;
  if (!Array.isArray(value.screens) || value.screens.length === 0) throw new Error('screens must be non-empty');
  const ids = new Set();
  value.screens.forEach((screen) => {
    if (!screen?.id || ids.has(screen.id)) throw new Error(`screen id is missing or duplicated: ${screen?.id}`);
    ids.add(screen.id);
    if (!Array.isArray(screen.pixels) || screen.pixels.length !== gridHeight) {
      throw new Error(`${screen.id}: expected ${gridHeight} pixel rows`);
    }
    screen.pixels.forEach((row, index) => {
      const cells = [...row];
      if (cells.length !== gridWidth) throw new Error(`${screen.id}: row ${index} has ${cells.length} cells; expected ${gridWidth}`);
      if (cells.some((cell) => cell !== value.blank && cell !== value.filled)) {
        throw new Error(`${screen.id}: row ${index} contains a character other than '${value.blank}' or '${value.filled}'`);
      }
    });
  });
}

function validateTypeSpec(value) {
  if (value?.schema !== 'schoolcalc.type/v1' || !Array.isArray(value.fonts) || value.fonts.length === 0) {
    throw new Error('type source must use schoolcalc.type/v1 with at least one font');
  }
  const ids = new Set();
  value.fonts.forEach((font) => {
    if (!font?.id || ids.has(font.id)) throw new Error(`font id is missing or duplicated: ${font?.id}`);
    ids.add(font.id);
    if (!Number.isInteger(font.width) || !Number.isInteger(font.height)
      || !Number.isInteger(font.advance_x) || !Number.isInteger(font.advance_y)) {
      throw new Error(`${font.id}: font metrics must be integers`);
    }
    for (const [character, rows] of Object.entries(font.glyphs ?? {})) {
      validatePixelRows(rows, font.width, font.height, value, `${font.id} glyph ${JSON.stringify(character)}`);
    }
    if (font.proportional !== undefined && typeof font.proportional !== 'boolean') {
      throw new Error(`${font.id}: proportional must be boolean`);
    }
    for (const [character, advance] of Object.entries(font.glyph_advances ?? {})) {
      if (!font.glyphs?.[character] || !Number.isInteger(advance) || advance < 1 || advance > font.advance_x) {
        throw new Error(`${font.id}: invalid advance for ${JSON.stringify(character)}`);
      }
    }
    for (const [character, row] of Object.entries(font.descender_rows ?? {})) {
      if (!font.glyphs?.[character]) throw new Error(`${font.id}: unknown descender glyph ${JSON.stringify(character)}`);
      validatePixelRows([row], font.width, 1, value, `${font.id} descender ${JSON.stringify(character)}`);
    }
  });
}

function validateIconSpec(value) {
  if (value?.schema !== 'schoolcalc.icons/v1' || !Array.isArray(value.icons) || value.icons.length === 0) {
    throw new Error('icon source must use schoolcalc.icons/v1 with at least one icon');
  }
  const ids = new Set();
  value.icons.forEach((icon) => {
    if (!icon?.id || ids.has(icon.id)) throw new Error(`icon id is missing or duplicated: ${icon?.id}`);
    ids.add(icon.id);
    validatePixelRows(icon.pixels, value.icon_width, value.icon_height, value, `icon ${icon.id}`);
  });
}

function validatePixelRows(rows, width, height, value, label) {
  if (!Array.isArray(rows) || rows.length !== height) throw new Error(`${label}: expected ${height} rows`);
  rows.forEach((row, index) => {
    if ([...row].length !== width) throw new Error(`${label}: row ${index} must be ${width} pixels`);
    if ([...row].some((cell) => cell !== value.blank && cell !== value.filled)) {
      throw new Error(`${label}: row ${index} contains an invalid pixel`);
    }
  });
}

function renderScreen(value, screen, scale) {
  const canvas = createCanvas(value.screen_width * scale, value.screen_height * scale);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#cbd4ad';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#17251c';
  const cell = scale;
  screen.pixels.forEach((row, y) => {
    [...row].forEach((pixel, x) => {
      if (pixel === value.filled) context.fillRect(x * cell, y * cell, cell, cell);
    });
  });
  return canvas;
}

function renderSheet(items, value, scale) {
  const columns = 2;
  const rows = Math.ceil(items.length / columns);
  const screenWidth = value.screen_width * scale;
  const screenHeight = value.screen_height * scale;
  const margin = 28;
  const labelHeight = 34;
  const canvas = createCanvas(
    margin + columns * (screenWidth + margin),
    margin + rows * (screenHeight + labelHeight + margin),
  );
  const context = canvas.getContext('2d');
  context.fillStyle = '#222822';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '18px sans-serif';
  context.fillStyle = '#edf1df';
  items.forEach(({ screen, canvas: rendered }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + column * (screenWidth + margin);
    const y = margin + row * (screenHeight + labelHeight + margin);
    context.fillText(`${screen.id} — ${screen.title}`, x, y + 20);
    context.drawImage(rendered, x, y + labelHeight);
  });
  return canvas;
}

function renderIconSheet(value, scale) {
  const columns = 6;
  const rows = Math.ceil(value.icons.length / columns);
  const cellWidth = 118;
  const cellHeight = 76;
  const canvas = createCanvas(columns * cellWidth, rows * cellHeight);
  const context = canvas.getContext('2d');
  context.fillStyle = '#222822';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '14px sans-serif';
  value.icons.forEach((icon, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = row * cellHeight;
    context.fillStyle = '#edf1df';
    context.fillText(icon.id, x + 8, y + 18);
    context.fillStyle = '#cbd4ad';
    context.fillRect(x + 8, y + 25, 52, 43);
    drawPixelRows(context, icon.pixels, value, x + 13, y + 29, Math.max(4, scale));
  });
  return canvas;
}

function renderTypeSheet(value, scale) {
  const columns = 14;
  const cellWidth = 52;
  const cellHeight = 52;
  const titleHeight = 42;
  const fontBlocks = value.fonts.map((font) => ({
    font,
    rows: Math.ceil(Object.keys(font.glyphs).length / columns),
  }));
  const canvas = createCanvas(
    columns * cellWidth,
    fontBlocks.reduce((height, block) => height + titleHeight + block.rows * cellHeight, 0),
  );
  const context = canvas.getContext('2d');
  context.fillStyle = '#222822';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '16px sans-serif';
  let top = 0;
  for (const { font, rows } of fontBlocks) {
    context.fillStyle = '#edf1df';
    context.fillText(
      `${font.id} — ${font.width}x${font.height}${font.descender_rows ? '+1 desc.' : ''}, ${font.proportional ? `proportional ≤${font.advance_x}` : `advance ${font.advance_x}`}x${font.advance_y}, ${font.case}`,
      8,
      top + 24,
    );
    Object.entries(font.glyphs).forEach(([character, pixels], index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = column * cellWidth;
      const y = top + titleHeight + row * cellHeight;
      context.fillStyle = '#cbd4ad';
      context.fillRect(x + 4, y + 2, 34, 36);
      const previewRows = font.descender_rows?.[character]
        ? [...pixels, font.descender_rows[character]]
        : pixels;
      drawPixelRows(context, previewRows, value, x + 7, y + 5, Math.max(3, scale));
      context.fillStyle = '#edf1df';
      context.font = '12px monospace';
      const advance = font.glyph_advances?.[character] ?? font.advance_x;
      context.fillText(`${character === ' ' ? 'space' : character} ${advance}px`, x + 4, y + 49);
      context.font = '16px sans-serif';
    });
    top += titleHeight + rows * cellHeight;
  }
  return canvas;
}

function drawPixelRows(context, rows, value, x, y, scale) {
  context.fillStyle = '#17251c';
  rows.forEach((row, yy) => [...row].forEach((cell, xx) => {
    if (cell === value.filled) context.fillRect(x + xx * scale, y + yy * scale, scale, scale);
  }));
}
