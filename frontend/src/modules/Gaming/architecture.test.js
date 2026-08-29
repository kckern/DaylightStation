import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const gamingRoot = dirname(fileURLToPath(import.meta.url));

function sourceFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.js', '.jsx', '.scss'].includes(extname(entry.name)) && !entry.name.includes('.test.') ? [path] : [];
  });
}

function importsMatching(root, pattern) {
  return sourceFiles(root).flatMap((path) => {
    const matches = readFileSync(path, 'utf8').split('\n').filter((line) => pattern.test(line));
    return matches.map((line) => `${path.slice(gamingRoot.length + 1)}: ${line.trim()}`);
  });
}

describe('Gaming package boundaries', () => {
  it('keeps production experiences independent of surface environments', () => {
    expect(importsMatching(join(gamingRoot, 'experiences'), /(?:from|@use).*environments\//)).toEqual([]);
  });

  it('keeps the common platform independent of experiences and environments', () => {
    expect(importsMatching(join(gamingRoot, 'platform'), /(?:from|@use).*(?:experiences|environments)\//)).toEqual([]);
  });
});
