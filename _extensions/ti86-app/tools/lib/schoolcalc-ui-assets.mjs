import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXTENSION = path.resolve(HERE, '..', '..');

export const UI_GLYPH_STRIDE = 8;
export const UI_ASCII_FIRST = 0x20;
export const UI_ASCII_LAST = 0x7E;
export const UI_ASCII_GLYPHS = UI_ASCII_LAST - UI_ASCII_FIRST + 1;

export function loadSchoolCalcUiAssets(extensionDirectory = DEFAULT_EXTENSION) {
  const typeSpec = yaml.load(readFileSync(path.join(extensionDirectory, 'gui', 'type.yml'), 'utf8'));
  const iconSpec = yaml.load(readFileSync(path.join(extensionDirectory, 'gui', 'icons.yml'), 'utf8'));
  if (typeSpec?.schema !== 'schoolcalc.type/v1') throw new Error('invalid SchoolCalc type schema');
  if (iconSpec?.schema !== 'schoolcalc.icons/v1') throw new Error('invalid SchoolCalc icon schema');
  if (typeSpec.blank !== '.' || typeSpec.filled !== '█') throw new Error('unsupported type pixels');
  if (iconSpec.blank !== '.' || iconSpec.filled !== '█') throw new Error('unsupported icon pixels');

  const fonts = new Map();
  for (const font of typeSpec.fonts ?? []) {
    validateFont(font, typeSpec);
    if (fonts.has(font.id)) throw new Error(`duplicate font '${font.id}'`);
    fonts.set(font.id, {
      id: font.id,
      // Retain the authored alphabet as well as the packed table.  Consumers
      // that inspect a framebuffer must not mistake the table's `?` fallback
      // entries for real, declared glyphs.
      characters: Object.freeze(Object.keys(font.glyphs ?? {})),
      width: font.width,
      height: font.height,
      advanceX: font.advance_x,
      advanceY: font.advance_y,
      proportional: font.proportional === true,
      hasDescenders: Object.keys(font.descender_rows ?? {}).length > 0,
      stride: font.height,
      bytes: packAsciiFont(font, typeSpec),
      bitmapBytes: packAsciiFont(font, typeSpec, { embedAdvance: false }),
    });
  }
  for (const required of ['compact-3x5', 'reader-4x6', 'display-5x7']) {
    if (!fonts.has(required)) throw new Error(`missing required font '${required}'`);
  }

  const icons = [];
  const iconIds = new Set();
  for (const icon of iconSpec.icons ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(icon.id)) throw new Error(`invalid icon id '${icon.id}'`);
    if (iconIds.has(icon.id)) throw new Error(`duplicate icon '${icon.id}'`);
    iconIds.add(icon.id);
    validateRows(icon.pixels, iconSpec.icon_width, iconSpec.icon_height, iconSpec, `icon '${icon.id}'`);
    icons.push({ id: icon.id, bytes: packRows(icon.pixels, iconSpec) });
  }
  if (icons.length > 32) throw new Error('TI-86 icon table supports at most 32 icons');

  return {
    fonts,
    icons,
    iconWidth: iconSpec.icon_width,
    iconHeight: iconSpec.icon_height,
  };
}

export function renderSchoolCalcFontSubsetAssembly(assets, {
  fontId,
  characters,
  label = `ui_font_${assemblyName(fontId).toLowerCase()}_subset`,
}) {
  const font = assets.fonts.get(fontId);
  if (!font) throw new Error(`unknown SchoolCalc font '${fontId}'`);
  if (typeof characters !== 'string' || characters.length === 0) {
    throw new Error('SchoolCalc font subset requires characters');
  }
  if (new Set(characters).size !== characters.length) {
    throw new Error('SchoolCalc font subset repeats a character');
  }
  const bytes = Buffer.concat([...characters].map((character) => {
    if (!font.characters.includes(character)) {
      throw new Error(`${fontId}: subset character '${character}' is not authored`);
    }
    const code = printableAsciiCode(character, 'renderSchoolCalcFontSubsetAssembly');
    const offset = (code - UI_ASCII_FIRST) * font.stride;
    return font.bitmapBytes.subarray(offset, offset + font.stride);
  }));
  return [
    `; Compact ${fontId} subset generated from gui/type.yml.`,
    `${label.toUpperCase()}_WIDTH: equ ${font.width}`,
    `${label.toUpperCase()}_HEIGHT: equ ${font.height}`,
    `${label}:`,
    ...assemblyBytes(bytes),
    '',
  ].join('\n');
}

export function renderSchoolCalcUiAssembly(assets, {
  fontIds = ['compact-3x5', 'reader-4x6', 'display-5x7'],
  iconIds = assets.icons.map((icon) => icon.id),
} = {}) {
  const selectedFonts = fontIds.map((id) => {
    const font = assets.fonts.get(id);
    if (!font) throw new Error(`unknown SchoolCalc font '${id}'`);
    return font;
  });
  if (new Set(fontIds).size !== fontIds.length) throw new Error('SchoolCalc font profile repeats an ID');
  const iconsById = new Map(assets.icons.map((icon) => [icon.id, icon]));
  const selectedIcons = iconIds.map((id) => {
    const icon = iconsById.get(id);
    if (!icon) throw new Error(`unknown SchoolCalc icon '${id}'`);
    return icon;
  });
  if (new Set(iconIds).size !== iconIds.length) throw new Error('SchoolCalc icon profile repeats an ID');
  const lines = [
    '; Generated from gui/type.yml and gui/icons.yml. Do not hand edit.',
    `UI_GLYPH_STRIDE: equ ${UI_GLYPH_STRIDE}`,
    `UI_ASCII_FIRST: equ ${UI_ASCII_FIRST}`,
    `UI_ASCII_LAST: equ ${UI_ASCII_LAST}`,
    `UI_ICON_WIDTH: equ ${assets.iconWidth}`,
    `UI_ICON_HEIGHT: equ ${assets.iconHeight}`,
    `UI_ICON_COUNT: equ ${selectedIcons.length}`,
  ];

  selectedIcons.forEach((icon, index) => {
    lines.push(`UI_ICON_${assemblyName(icon.id)}: equ ${index}`);
  });
  for (const font of selectedFonts) {
    lines.push(
      '',
      `UI_FONT_${assemblyName(font.id)}_STRIDE: equ ${font.stride}`,
      `UI_FONT_${assemblyName(font.id)}_PROPORTIONAL: equ ${font.proportional ? 1 : 0}`,
      `UI_FONT_${assemblyName(font.id)}_DESCENDERS: equ ${font.hasDescenders ? 1 : 0}`,
      `ui_font_${assemblyName(font.id).toLowerCase()}:`,
      ...assemblyBytes(font.bytes),
    );
  }
  if (selectedIcons.length > 0) {
    lines.push('', 'ui_icon_table:');
    for (const icon of selectedIcons) lines.push(...assemblyBytes(icon.bytes));
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function glyphRows(font, character) {
  const code = printableAsciiCode(character, 'glyphRows');
  const offset = (code - UI_ASCII_FIRST) * font.stride;
  const pixelMask = (0xFF << (8 - font.width)) & 0xFF;
  return [...font.bitmapBytes.subarray(offset, offset + font.height)].map((row) => row & pixelMask);
}

export function glyphAdvance(font, character) {
  const code = printableAsciiCode(character, 'glyphAdvance');
  return font.bytes[(code - UI_ASCII_FIRST) * font.stride] & 0x07;
}

export function glyphDescenderRow(font, character) {
  const code = printableAsciiCode(character, 'glyphDescenderRow');
  const packed = font.bytes[(code - UI_ASCII_FIRST) * font.stride + font.height - 1];
  const lowMask = (1 << font.width) - 1;
  return (packed & lowMask) << (8 - font.width);
}

function validateFont(font, spec) {
  if (!/^[a-z][a-z0-9-]*$/.test(font.id)) throw new Error(`invalid font id '${font.id}'`);
  if (!Number.isInteger(font.width) || font.width < 1 || font.width > 8) {
    throw new Error(`${font.id}: width must be 1..8`);
  }
  if (!Number.isInteger(font.height) || font.height < 1 || font.height > UI_GLYPH_STRIDE) {
    throw new Error(`${font.id}: height must be 1..${UI_GLYPH_STRIDE}`);
  }
  if (!Number.isInteger(font.advance_x) || font.advance_x < font.width || font.advance_x > 7) {
    throw new Error(`${font.id}: invalid horizontal advance`);
  }
  if (!Number.isInteger(font.advance_y) || font.advance_y < font.height || font.advance_y > 9) {
    throw new Error(`${font.id}: invalid vertical advance`);
  }
  for (const [character, rows] of Object.entries(font.glyphs ?? {})) {
    if ([...character].length !== 1 || character.codePointAt(0) > 127) {
      throw new Error(`${font.id}: glyph keys must be one ASCII character`);
    }
    validateRows(rows, font.width, font.height, spec, `${font.id} '${character}'`);
  }
  if (!font.glyphs?.[' '] || !font.glyphs?.['?']) {
    throw new Error(`${font.id}: space and question-mark fallback glyphs are required`);
  }
  if (font.proportional !== undefined && typeof font.proportional !== 'boolean') {
    throw new Error(`${font.id}: proportional must be boolean`);
  }
  const advances = font.glyph_advances ?? {};
  if (!font.proportional && Object.keys(advances).length > 0) {
    throw new Error(`${font.id}: glyph_advances require proportional: true`);
  }
  for (const [character, advance] of Object.entries(advances)) {
    if ([...character].length !== 1 || character.codePointAt(0) > 127 || !font.glyphs?.[character]) {
      throw new Error(`${font.id}: glyph advance keys must name a declared ASCII glyph`);
    }
    if (!Number.isInteger(advance) || advance < 1 || advance > font.advance_x) {
      throw new Error(`${font.id}: invalid advance for '${character}'`);
    }
    const rightmostInk = font.glyphs[character].reduce((rightmost, row) => (
      Math.max(rightmost, [...row].lastIndexOf(spec.filled))
    ), -1);
    if (rightmostInk >= advance - 1) {
      throw new Error(`${font.id}: '${character}' needs one blank column inside its ${advance}px advance`);
    }
  }
  const descenders = font.descender_rows ?? {};
  if (Object.keys(descenders).length > 0 && font.width > 4) {
    throw new Error(`${font.id}: packed descenders require a font no wider than 4 pixels`);
  }
  for (const [character, row] of Object.entries(descenders)) {
    if ([...character].length !== 1 || !font.glyphs?.[character]) {
      throw new Error(`${font.id}: descender keys must name a declared glyph`);
    }
    validateRows([row], font.width, 1, spec, `${font.id} '${character}' descender`);
  }
}

function validateRows(rows, width, height, spec, label) {
  if (!Array.isArray(rows) || rows.length !== height) throw new Error(`${label}: expected ${height} rows`);
  rows.forEach((row, y) => {
    const pixels = [...row];
    if (pixels.length !== width) throw new Error(`${label}: row ${y} must be ${width} pixels`);
    for (const pixel of pixels) {
      if (pixel !== spec.blank && pixel !== spec.filled) throw new Error(`${label}: invalid pixel '${pixel}'`);
    }
  });
}

function packAsciiFont(font, spec, { embedAdvance = true } = {}) {
  const bytes = Buffer.alloc(UI_ASCII_GLYPHS * font.height);
  for (let code = UI_ASCII_FIRST; code <= UI_ASCII_LAST; code += 1) {
    let character = String.fromCharCode(code);
    if (font.case === 'uppercase' && character >= 'a' && character <= 'z') character = character.toUpperCase();
    const sourceCharacter = font.glyphs[character] ? character : '?';
    const rows = font.glyphs[sourceCharacter];
    const packed = packRows(rows, spec, font.height);
    if (embedAdvance) packed[0] |= (font.glyph_advances?.[sourceCharacter] ?? font.advance_x) & 0x07;
    const descender = font.descender_rows?.[sourceCharacter];
    if (descender) {
      [...descender].forEach((pixel, x) => {
        if (pixel === spec.filled) packed[font.height - 1] |= 1 << (font.width - 1 - x);
      });
    }
    packed.copy(bytes, (code - UI_ASCII_FIRST) * font.height);
  }
  return bytes;
}

function printableAsciiCode(character, caller) {
  if ([...String(character)].length !== 1) {
    throw new Error(`${caller} accepts one printable ASCII character`);
  }
  const code = character.codePointAt(0);
  if (code < UI_ASCII_FIRST || code > UI_ASCII_LAST) {
    throw new Error(`${caller} accepts one printable ASCII character`);
  }
  return code;
}

function packRows(rows, spec, stride = UI_GLYPH_STRIDE) {
  const bytes = Buffer.alloc(stride);
  rows.forEach((row, y) => {
    [...row].forEach((pixel, x) => {
      if (pixel === spec.filled) bytes[y] |= 0x80 >> x;
    });
  });
  return bytes;
}

function assemblyBytes(bytes) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    lines.push(`        defb ${[...bytes.subarray(offset, offset + 16)]
      .map((byte) => `0x${byte.toString(16).padStart(2, '0')}`)
      .join(',')}`);
  }
  return lines;
}

function assemblyName(value) {
  return value.replaceAll('-', '_').toUpperCase();
}
