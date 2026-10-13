import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const experiences = resolve(root, '__app_modules/party-games/browser/experiences');
const environment = resolve(root, '__app_modules/party-games/browser');
const platform = resolve(root, '__capabilities/gaming/browser/platform');
const inside = (target, directory) => target === directory || target.startsWith(`${directory}/`);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return ['.js', '.jsx', '.scss'].includes(extname(entry.name)) && !entry.name.includes('.test.') ? [file] : [];
  });
}

function forbiddenImports(directory, legacyPattern, isForbidden) {
  const files = sourceFiles(directory);
  expect(files.length).toBeGreaterThan(0);
  return files.flatMap((file) => {
    const imports = [...readFileSync(file, 'utf8').matchAll(/(?:from|@use)\s*['"]([^'"]+)['"]/g)];
    return imports.filter(([, specifier]) => legacyPattern.test(specifier) || (specifier.startsWith('.') && isForbidden(resolve(dirname(file), specifier))))
      .map(([, specifier]) => `${file}: ${specifier}`);
  });
}

describe('Gaming package boundaries', () => {
  it('keeps production experiences independent of surface environments', () => {
    expect(forbiddenImports(experiences, /environments\//, (target) => inside(target, environment) && !inside(target, experiences))).toEqual([]);
  });

  it('keeps the common platform independent of experiences and environments', () => {
    expect(forbiddenImports(platform, /(?:experiences|environments)\//, (target) => inside(target, environment))).toEqual([]);
  });
});
