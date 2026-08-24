import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installBundle, installManifest, verifyBundle } from './gaming-artifacts.cli.mjs';

const roots = [];
const root = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaming-install-')); roots.push(dir); return dir; };
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('gaming authored artifact installer', () => {
  it('installs separate bundle artifacts and a manifest', () => {
    const dir = root(); const rules = path.join(dir, 'rules.yml'); const content = path.join(dir, 'content.yml'); const manifest = path.join(dir, 'manifest.yml');
    fs.writeFileSync(rules, 'artifact: { kind: gaming-rules, version: 1, id: "dice:table" }\nrule_module: { id: dice, version: 1 }\nexperience: { id: dice, version: 1 }\nruleset: dice-v1\ndefault_notation: 1d6\n');
    fs.writeFileSync(content, 'artifact: { kind: gaming-content, version: 1, id: "dice:table" }\ntitle: Dice\n');
    fs.writeFileSync(manifest, 'id: dice\nversion: 1\nnative_surface_id: group-play\npresenters: { primary: dice-table }\n');
    installBundle({ dataDir: dir, id: 'dice:table', rulesFile: rules, contentFile: content });
    installManifest({ dataDir: dir, sourceFile: manifest });
    expect(fs.existsSync(path.join(dir, 'household/gaming/games/dice:table/rules.yml'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'household/gaming/manifests/dice.yml'))).toBe(true);
    expect(verifyBundle({ dataDir: dir, id: 'dice:table' })).toMatchObject({
      valid: true,
      id: 'dice:table',
      rule_module: { id: 'dice', version: 1 },
      rules_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      content_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      definition_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('rejects overlapping artifact responsibilities', () => {
    const dir = root(); const rules = path.join(dir, 'rules.yml'); const content = path.join(dir, 'content.yml');
    fs.writeFileSync(rules, 'artifact: { kind: gaming-rules, version: 1, id: bad }\nrule_module: { id: dice, version: 1 }\nexperience: { id: dice, version: 1 }\ntitle: rules title\n');
    fs.writeFileSync(content, 'artifact: { kind: gaming-content, version: 1, id: bad }\ntitle: content title\n');
    expect(() => installBundle({ dataDir: dir, id: 'bad', rulesFile: rules, contentFile: content })).toThrow('overlap');
  });

  it('rejects bundles without explicit artifact contracts', () => {
    const dir = root(); const rules = path.join(dir, 'rules.yml'); const content = path.join(dir, 'content.yml');
    fs.writeFileSync(rules, 'ruleset: dice-v1\n'); fs.writeFileSync(content, 'title: Dice\n');
    expect(() => installBundle({ dataDir: dir, id: 'dice:table', rulesFile: rules, contentFile: content })).toThrow('artifact');
  });

  it('rejects a structurally valid bundle that fails its rule module', () => {
    const dir = root(); const rules = path.join(dir, 'rules.yml'); const content = path.join(dir, 'content.yml');
    fs.writeFileSync(rules, 'artifact: { kind: gaming-rules, version: 1, id: broken }\nrule_module: { id: dice, version: 1 }\nexperience: { id: dice, version: 1 }\n');
    fs.writeFileSync(content, 'artifact: { kind: gaming-content, version: 1, id: broken }\ntitle: Broken dice\n');
    installBundle({ dataDir: dir, id: 'broken', rulesFile: rules, contentFile: content });
    expect(() => verifyBundle({ dataDir: dir, id: 'broken' })).toThrow('default_notation');
  });
});
