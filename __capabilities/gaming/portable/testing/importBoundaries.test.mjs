import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(root, entry.name)) : entry.name.endsWith('.mjs') ? [path.join(root, entry.name)] : []);
}

function sourceFiles(root) {
  if (!fs.existsSync(root)) throw new Error(`Missing architecture source root: ${root}`);
  if (fs.statSync(root).isFile()) return [root];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') return [];
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:[cm]?[jt]sx?|md|s?css|html|ya?ml|json)$/i.test(entry.name) ? [target] : [];
  });
}

describe('Gaming import boundaries', () => {
  it('keeps shared Gaming free of consumers and infrastructure', () => {
    const root = path.resolve('__capabilities/gaming/portable'); const violations = [];
    for (const file of files(root).filter((candidate) => !candidate.endsWith('.test.mjs'))) {
      const source = fs.readFileSync(file, 'utf8');
      if (/from\s+['"](?:node:|#(?:system|adapters|apps|api|composition)|.*(?:backend|frontend|modules)\/)/.test(source)) violations.push(path.relative(root, file));
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
      "__capabilities/gaming/portable/kernel",
      "__capabilities/gaming/portable/experience",
      "__capabilities/gaming/portable/presentation",
      "__capabilities/gaming/portable/mechanics",
      "__capabilities/gaming/server/adapters/persistence",
      "__app_modules/games/party-games/server/adapters/persistence",
      "__app_modules/games/arcade/server/domain",
      "__app_modules/learning/piano/server/domain/game-platform",
      "__app_modules/games/party-games/server/application",
      "__app_modules/games/arcade/server/application",
      "__capabilities/gaming/server/application",
      "__capabilities/device-dispatch/server/application/ports/IReaderPresence.mjs",
      "__app_modules/games/party-games/server/api/gaming.mjs",
      "__app_modules/games/party-games/server/composition/gamingApi.mjs",
      "__capabilities/gaming/browser/platform",
      "__app_modules/games/party-games/browser",
      "frontend/src/composition/gaming",
      "__app_modules/learning/piano/browser/PianoCardGame",
      "__app_modules/games/party-games/cli/gaming-artifacts.cli.mjs",
      "__docs/reference/gaming"
];
    const filesToCheck = roots.flatMap((root) => {
      const absolute = path.resolve(root);
      return sourceFiles(absolute);
    });
    filesToCheck.push(path.resolve('__app_modules/learning/piano/server/application/PianoScaleChallengePolicy.mjs'));
    const violations = filesToCheck.filter((file) => {
      if (brandedTerm.test(path.basename(file))) return true;
      return brandedTerm.test(fs.readFileSync(file, 'utf8'));
    }).map((file) => path.relative(process.cwd(), file));
    expect(violations).toEqual([]);
  });

  it('keeps franchise-shaped presentation fields out of generic Gaming', () => {
    const roots = [
      "__capabilities/gaming/portable",
      "__app_modules/games/arcade/server/domain",
      "__app_modules/learning/piano/server/domain/game-platform",
      "__app_modules/games/party-games/server/application",
      "__app_modules/games/arcade/server/application",
      "__capabilities/gaming/server/application",
      "__capabilities/gaming/browser/platform",
      "__app_modules/games/party-games/browser"
];
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
      "__capabilities/gaming/portable",
      "__capabilities/gaming/server",
      "__capabilities/gaming/browser"
];
    const contextImport = /(?:from\s*|import\s*\()\s*['"][^'"]*(?:\/Piano\/|\/Fitness\/|\/GameShow\/|\/gameshow\/|\/modules\/)/i;
    const violations = roots.flatMap((root) => sourceFiles(path.resolve(root))).filter((file) => (
      contextImport.test(fs.readFileSync(file, 'utf8'))
    )).map((file) => path.relative(process.cwd(), file));
    expect(violations).toEqual([]);
  });
});
