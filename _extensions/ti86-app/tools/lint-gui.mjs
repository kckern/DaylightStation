#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { lintSchoolCalcDesignSystem } from './lib/schoolcalc-design-system.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUI = path.resolve(HERE, '../gui');

export function lintSchoolCalcGuiFiles({ guiDirectory = GUI } = {}) {
  const load = (name) => yaml.load(fs.readFileSync(path.join(guiDirectory, name), 'utf8'));
  return lintSchoolCalcDesignSystem({
    design: load('design-system.yml'),
    screens: load('screens.yml'),
    type: load('type.yml'),
    icons: load('icons.yml'),
  });
}

const result = lintSchoolCalcGuiFiles();
if (!result.ok) {
  result.errors.forEach((error) => process.stderr.write(`- ${error}\n`));
  process.stderr.write(`SchoolCalc GUI lint failed with ${result.errors.length} error(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `SchoolCalc GUI clean: ${result.summary.components} components, `
    + `${result.summary.templates} templates, ${result.summary.screens} full-frame goldens\n`,
  );
}
