import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { lintSchoolCalcDesignSystem } from './schoolcalc-design-system.mjs';

const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../gui');
const fixtures = Object.freeze({
  design: load('design-system.yml'),
  screens: load('screens.yml'),
  type: load('type.yml'),
  icons: load('icons.yml'),
});

describe('SchoolCalc design-system lint', () => {
  it('covers every required component/template with full 128x64 goldens', () => {
    expect(lintSchoolCalcDesignSystem(fixtures)).toEqual({
      schema: 'schoolcalc.design-system-lint/v1',
      ok: true,
      errors: [],
      summary: { components: 56, templates: 27, coveredTemplates: 27, screens: 33 },
    });
  });

  it('rejects a lost header margin and boxed ordinary content', () => {
    const mutated = cloneFixtures();
    const home = mutated.screens.screens.find(({ id }) => id === 'home');
    home.pixels[8] = `█${home.pixels[8].slice(1)}`;
    const notes = mutated.screens.screens.find(({ id }) => id === 'notes');
    notes.pixels = clearBody(notes.pixels);
    notes.pixels = drawFrame(notes.pixels, 10, 12, 70, 20);
    const result = lintSchoolCalcDesignSystem(mutated);
    expect(result.errors).toContain("screen 'home' must preserve the blank y=8 header margin");
    expect(result.errors.some((error) => error.includes("screen 'notes' boxes ordinary body content"))).toBe(true);
  });

  it('rejects redundant hardware softkeys and missing template coverage', () => {
    const mutated = cloneFixtures();
    const home = mutated.screens.screens.find(({ id }) => id === 'home');
    home.interaction.softkeys[0] = { action: 'quit', label: 'EXIT' };
    mutated.screens.screens = mutated.screens.screens.filter(({ template }) => template !== 'storage');
    const result = lintSchoolCalcDesignSystem(mutated);
    expect(result.errors).toContain("screen 'home' F1 duplicates hardware action 'EXIT'");
    expect(result.errors).toContain("required template 'storage' has no golden screen");
  });

  it('rejects confirmation copy that escapes its measured dialog bounds', () => {
    const mutated = cloneFixtures();
    const confirmation = mutated.screens.screens.find(({ id }) => id === 'confirm');
    const row = [...confirmation.pixels[20]];
    row[118] = '█';
    confirmation.pixels[20] = row.join('');
    expect(lintSchoolCalcDesignSystem(mutated).errors)
      .toContain("screen 'confirm' content escapes the confirmation frame at 118,20");
  });
});

function load(name) {
  return yaml.load(fs.readFileSync(path.join(GUI, name), 'utf8'));
}

function cloneFixtures() {
  return structuredClone(fixtures);
}

function drawFrame(rows, x, y, width, height) {
  const pixels = rows.map((row) => [...row]);
  for (let xx = x; xx < x + width; xx += 1) {
    pixels[y][xx] = '█';
    pixels[y + height - 1][xx] = '█';
  }
  for (let yy = y; yy < y + height; yy += 1) {
    pixels[yy][x] = '█';
    pixels[yy][x + width - 1] = '█';
  }
  return pixels.map((row) => row.join(''));
}

function clearBody(rows) {
  return rows.map((row, y) => (y >= 9 && y <= 54 ? '.'.repeat(128) : row));
}
