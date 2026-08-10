import { describe, expect, it } from 'vitest';
import {
  glyphAdvance,
  glyphDescenderRow,
  glyphRows,
  loadSchoolCalcUiAssets,
  renderSchoolCalcFontSubsetAssembly,
  renderSchoolCalcUiAssembly,
  UI_ASCII_GLYPHS,
  UI_ASCII_FIRST,
  UI_ASCII_LAST,
  UI_GLYPH_STRIDE,
} from './schoolcalc-ui-assets.mjs';

describe('SchoolCalc TI-86 UI assets', () => {
  it('compiles height-stride fonts and maps compact lowercase to uppercase', () => {
    const assets = loadSchoolCalcUiAssets();
    for (const font of assets.fonts.values()) {
      expect(font.stride).toBe(font.height);
      expect(font.bytes).toHaveLength(UI_ASCII_GLYPHS * font.height);
    }
    expect(UI_ASCII_FIRST).toBe(0x20);
    expect(UI_ASCII_LAST).toBe(0x7E);
    const compact = assets.fonts.get('compact-3x5');
    expect(glyphRows(compact, 'a')).toEqual(glyphRows(compact, 'A'));
    expect(glyphRows(compact, 'A')).toEqual([0x40, 0xA0, 0xE0, 0xA0, 0xA0]);
    expect(glyphRows(compact, '&')).toEqual([0x40, 0xA0, 0x40, 0xA0, 0x60]);
    expect(glyphRows(compact, 'V')).not.toEqual(glyphRows(compact, 'U'));

    const reader = assets.fonts.get('reader-4x6');
    expect(glyphRows(reader, 'a')).not.toEqual(glyphRows(reader, 'A'));
    expect(reader.proportional).toBe(true);
    expect(reader.hasDescenders).toBe(true);
    expect(reader.advanceX).toBe(5);
    expect(reader.advanceY).toBe(7);
    expect(glyphAdvance(reader, 'i')).toBe(3);
    expect(glyphAdvance(reader, 'm')).toBe(5);
    expect(glyphAdvance(reader, '.')).toBe(2);
    expect(glyphDescenderRow(reader, 'q')).toBe(0x20);
    expect(glyphDescenderRow(reader, 'A')).toBe(0x00);
  });

  it('compiles the declared icon order and reviewable assembly labels', () => {
    const assets = loadSchoolCalcUiAssets();
    expect(assets.icons.map((icon) => icon.id)).toContain('qr');
    expect(assets.icons.every((icon) => icon.bytes.length === UI_GLYPH_STRIDE)).toBe(true);
    const assembly = renderSchoolCalcUiAssembly(assets);
    expect(assembly).toContain('UI_ICON_HOME: equ 0');
    expect(assembly).toContain('ui_font_reader_4x6:');
    expect(assembly).toContain('ui_icon_table:');

    const shellAssembly = renderSchoolCalcUiAssembly(assets, {
      fontIds: ['compact-3x5', 'reader-4x6'], iconIds: [],
    });
    expect(shellAssembly).toContain('UI_ICON_COUNT: equ 0');
    expect(shellAssembly).toContain('UI_FONT_COMPACT_3X5_STRIDE: equ 5');
    expect(shellAssembly).toContain('UI_FONT_READER_4X6_STRIDE: equ 6');
    expect(shellAssembly).toContain('UI_FONT_READER_4X6_PROPORTIONAL: equ 1');
    expect(shellAssembly).toContain('UI_FONT_READER_4X6_DESCENDERS: equ 1');
    expect(shellAssembly).toContain('ui_font_reader_4x6:');
    expect(shellAssembly).not.toContain('ui_font_display_5x7:');
    expect(shellAssembly).not.toContain('ui_icon_table:');
  });

  it('emits the code-only face as an exact compact glyph subset', () => {
    const assets = loadSchoolCalcUiAssets();
    const font = assets.fonts.get('code-7x8');
    expect(font.width).toBe(7);
    expect(font.height).toBe(8);
    expect(font.characters).toEqual(expect.arrayContaining(['-', '0', '9']));

    const assembly = renderSchoolCalcFontSubsetAssembly(assets, {
      fontId: 'code-7x8',
      characters: '-0123456789',
      label: 'shell_code_font',
    });
    expect(assembly).toContain('SHELL_CODE_FONT_WIDTH: equ 7');
    expect(assembly).toContain('SHELL_CODE_FONT_HEIGHT: equ 8');
    expect(assembly).toContain('shell_code_font:');
    expect(assembly.match(/0x[0-9a-f]{2}/g)).toHaveLength(11 * 8);
    expect(() => renderSchoolCalcFontSubsetAssembly(assets, {
      fontId: 'code-7x8', characters: '-A',
    })).toThrow("subset character 'A' is not authored");
  });
});
