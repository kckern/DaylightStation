import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(root, entry.name)) : entry.name.endsWith('.mjs') ? [path.join(root, entry.name)] : []);
}

function sourceFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') return [];
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:[cm]?[jt]sx?|md|s?css|html|ya?ml|json)$/i.test(entry.name) ? [target] : [];
  });
}

describe('Gaming import boundaries', () => {
  it('keeps shared Gaming free of consumers and infrastructure', () => {
    const root = path.resolve('shared/gaming'); const violations = [];
    for (const file of files(root).filter((candidate) => !candidate.endsWith('.test.mjs'))) {
      const source = fs.readFileSync(file, 'utf8');
      if (/from\s+['"](?:node:|#(?:system|adapters|apps|api|composition)|.*(?:backend|frontend)\/)/.test(source)) violations.push(path.relative(root, file));
    }
    expect(violations).toEqual([]);
  });

  it('keeps franchise identity out of generic Gaming and its Piano challenge adapter', () => {
    const brandedTerm = new RegExp([
      ['poke', 'mon'].join(''),
      ['pika', 'chu'].join(''),
      ['squirt', 'le'].join(''),
      ['pid', 'gey'].join(''),
      ['toge', 'pi'].join(''),
      ['poke', 'dex'].join(''),
    ].join('|'), 'i');
    const roots = [
      'shared/gaming/kernel',
      'shared/gaming/experience',
      'shared/gaming/presentation',
      'shared/gaming/mechanics',
      'backend/src/1_adapters/persistence/yaml/gaming',
      'backend/src/2_domains/gaming',
      'backend/src/3_applications/gaming',
      'backend/src/4_api/v1/routers/gaming.mjs',
      'backend/src/5_composition/modules/gamingApi.mjs',
      'frontend/src/modules/Gaming',
      'frontend/src/modules/Piano/PianoCardGame',
      'cli/gaming-artifacts.cli.mjs',
      'docs/reference/gaming',
    ];
    const filesToCheck = roots.flatMap((root) => {
      const absolute = path.resolve(root);
      return fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? [absolute] : sourceFiles(absolute);
    });
    filesToCheck.push(path.resolve('backend/src/3_applications/piano/PianoScaleChallengePolicy.mjs'));
    const violations = filesToCheck.filter((file) => {
      if (brandedTerm.test(path.basename(file))) return true;
      return brandedTerm.test(fs.readFileSync(file, 'utf8'));
    }).map((file) => path.relative(process.cwd(), file));
    expect(violations).toEqual([]);
  });

  it('keeps franchise-shaped presentation fields out of generic Gaming', () => {
    const roots = ['shared/gaming', 'backend/src/2_domains/gaming', 'backend/src/3_applications/gaming', 'frontend/src/modules/Gaming'];
    const themedSchema = new RegExp(`\\b(?:${[
      ['de', 'x'].join(''),
      ['gen', 'us'].join(''),
      ['move', 'type'].join('_'),
    ].join('|')})\\b`);
    const violations = roots.flatMap((root) => sourceFiles(path.resolve(root))).filter((file) => !file.endsWith('importBoundaries.test.mjs')).filter((file) => (
      themedSchema.test(fs.readFileSync(file, 'utf8'))
    )).map((file) => path.relative(process.cwd(), file));
    expect(violations).toEqual([]);
  });

  it('keeps the generic Gaming implementation independent of native contexts', () => {
    const roots = [
      'frontend/src/modules/Gaming',
      'backend/src/2_domains/gaming',
      'backend/src/3_applications/gaming',
    ];
    const contextImport = /(?:from\s*|import\s*\()\s*['"][^'"]*(?:\/Piano\/|\/Fitness\/|\/GameShow\/|\/gameshow\/)/i;
    const violations = roots.flatMap((root) => sourceFiles(path.resolve(root))).filter((file) => (
      contextImport.test(fs.readFileSync(file, 'utf8'))
    )).map((file) => path.relative(process.cwd(), file));
    expect(violations).toEqual([]);
  });
});
