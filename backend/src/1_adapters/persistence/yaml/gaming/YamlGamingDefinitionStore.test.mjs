import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlGamingDefinitionStore } from './YamlGamingDefinitionStore.mjs';

const dirs = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gaming-artifacts-')); dirs.push(root);
  return { root, store: new YamlGamingDefinitionStore({ definitionsDir: path.join(root, 'games'), archiveDir: path.join(root, 'archive') }) };
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('YamlGamingDefinitionStore authored artifact boundaries', () => {
  it('composes, independently hashes, pins, and reloads rules and content artifacts', () => {
    const { root, store } = fixture(); const dir = path.join(root, 'games', 'demo'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'rules.yml'), 'artifact: { kind: gaming-rules, version: 1, id: demo }\nrule_module: { id: dice, version: 1 }\nexperience: { id: dice, version: 1 }\nschema_version: 1\nruleset: dice-v1\ndefault_notation: 1d6\n');
    fs.writeFileSync(path.join(dir, 'content.yml'), 'artifact: { kind: gaming-content, version: 1, id: demo }\ntitle: Table Dice\n');
    const loaded = store.getCurrent('demo');
    expect(loaded.definition).toEqual({ rule_module: { id: 'dice', version: 1 }, experience: { id: 'dice', version: 1 }, schema_version: 1, ruleset: 'dice-v1', default_notation: '1d6', title: 'Table Dice' });
    expect(loaded.artifacts.rules_definition.hash).not.toBe(loaded.artifacts.content_pack.hash);
    const pinned = store.pin(loaded);
    expect(store.getPinned(pinned.hash)).toEqual(loaded.definition);
  });

  it('rejects combined game.yml files and cross-artifact key collisions', () => {
    const { root, store } = fixture(); const dir = path.join(root, 'games', 'demo'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'game.yml'), 'ruleset: dice-v1\ntitle: forbidden\n');
    expect(store.getCurrent('demo')).toBeNull();
    fs.writeFileSync(path.join(dir, 'rules.yml'), 'artifact: { kind: gaming-rules, version: 1, id: demo }\nrule_module: { id: dice, version: 1 }\nexperience: { id: dice, version: 1 }\nruleset: dice-v1\n');
    fs.writeFileSync(path.join(dir, 'content.yml'), 'artifact: { kind: gaming-content, version: 1, id: demo }\nruleset: duplicated\n');
    expect(() => store.getCurrent('demo')).toThrow('repeats keys');
  });

  it('lists and reads content packs without exposing rules as catalog content', () => {
    const { root, store } = fixture();
    for (const id of ['jeopardy:night-two', 'jeopardy:night-one', 'dice:table']) {
      const dir = path.join(root, 'games', id); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'rules.yml'), `artifact: { kind: gaming-rules, version: 1, id: "${id}" }\nrule_module: { id: ${id.split(':')[0]}, version: 1 }\nexperience: { id: ${id.split(':')[0]}, version: 1 }\nrules_contract: ${id.split(':')[0]}-v1\n`);
      fs.writeFileSync(path.join(dir, 'content.yml'), `artifact: { kind: gaming-content, version: 1, id: "${id}" }\nid: ${id.split(':')[1]}\ntitle: Mounted\n`);
    }
    expect(store.listIds({ prefix: 'jeopardy' })).toEqual(['jeopardy:night-one', 'jeopardy:night-two']);
    expect(store.getContent('jeopardy:night-one')).toEqual({ id: 'night-one', title: 'Mounted' });
    expect(() => store.listIds({ prefix: '../bad' })).toThrow('invalid definition prefix');
  });
});
