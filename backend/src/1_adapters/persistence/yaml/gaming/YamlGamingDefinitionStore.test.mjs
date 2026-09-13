import crypto from 'node:crypto';
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

describe('external Charades clue bank', () => {
  function bankFixture() {
    const { root } = fixture();
    const contentGamesDir = path.join(root, 'content');
    const dir = path.join(root, 'games/demo');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(contentGamesDir, 'charades/images'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'rules.yml'), 'artifact: { kind: gaming-rules, version: 1, id: demo }\nrule_module: { id: activity-party, version: 1 }\nexperience: { id: charades, version: 1 }\n');
    fs.writeFileSync(path.join(dir, 'content.yml'), 'artifact: { kind: gaming-content, version: 1, id: demo }\nclue_bank: charades/choices.yml\n');
    const bank = path.join(contentGamesDir, 'charades/choices.yml');
    fs.writeFileSync(path.join(contentGamesDir, 'charades/images/rabbit.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(bank, 'version: 1\nclues:\n  - { id: rabbit, text: Rabbit, image: images/rabbit.svg }\n  - { id: swimming, text: Swimming }\n');
    const store = new YamlGamingDefinitionStore({ definitionsDir: path.join(root, 'games'), archiveDir: path.join(root, 'archive'), contentGamesDir });
    return { root, dir, bank, store, contentGamesDir };
  }

  it('compiles images and text, pins content, and hashes later bank edits independently', () => {
    const { store, bank } = bankFixture();
    const first = store.getCurrent('demo');
    expect(first.definition.challenges).toEqual([
      { id: 'rabbit', activity: 'charades', prompt: 'Rabbit', decoder: { image: `/api/v1/gaming/media/content/${crypto.createHash('sha256').update('<svg xmlns="http://www.w3.org/2000/svg"/>').digest('hex')}/charades/images/rabbit.svg` } },
      { id: 'swimming', activity: 'charades', prompt: 'Swimming' },
    ]);
    store.pin(first);
    fs.writeFileSync(bank, 'version: 1\nclues:\n  - { id: flying, text: Flying }\n');
    const second = store.getCurrent('demo');
    expect(second.hash).not.toBe(first.hash);
    expect(second.artifacts.rules_definition).toEqual(first.artifacts.rules_definition);
    expect(store.getPinned(first.hash).challenges).toEqual(first.definition.challenges);
  });

  it('pins image bytes and changes image URLs when source art changes', () => {
    const {store, root, contentGamesDir} = bankFixture();
    const first = store.getCurrent('demo');
    const imageUrl = first.definition.challenges[0].decoder.image;
    const hash = imageUrl.split('/content/')[1].split('/')[0];
    const archive = path.join(root, 'archive/images', `${hash}.svg`);
    expect(fs.existsSync(archive)).toBe(false); // previews/diagnostics do not pin
    store.pin(first);
    const original = fs.readFileSync(archive, 'utf8');
    fs.writeFileSync(path.join(contentGamesDir, 'charades/images/rabbit.svg'), '<svg><!-- changed --></svg>');
    expect(store.getCurrent('demo').definition.challenges[0].decoder.image).not.toBe(imageUrl);
    expect(store.getPinned(first.hash).challenges[0].decoder.image).toBe(imageUrl);
    expect(fs.readFileSync(archive, 'utf8')).toBe(original);
  });

  it.each([
    ['version: 1\nclues: [{id: same, text: One}, {id: same, text: Two}]', /duplicate/i],
    ['version: 1\nclues: [{id: empty, text: ""}]', /text/i],
    ['version: 1\nclues: [{id: missing, text: Missing, image: images/nope.svg}]', /image/i],
    ['version: 1\nclues: [{id: escape, text: Escape, image: ../../outside.svg}]', /contained|relative/i],
  ])('rejects invalid authored bank %s', (yaml, error) => {
    const { store, bank } = bankFixture(); fs.writeFileSync(bank, yaml);
    expect(() => store.getCurrent('demo')).toThrow(error);
  });

  it('rejects bank path traversal and symlinks outside configured content root', () => {
    const { store, bank, root, dir } = bankFixture();
    fs.writeFileSync(path.join(dir, 'content.yml'), 'artifact: { kind: gaming-content, version: 1, id: demo }\nclue_bank: ../outside.yml\n');
    expect(() => store.getCurrent('demo')).toThrow(/contained|relative/i);
    fs.writeFileSync(path.join(dir, 'content.yml'), 'artifact: { kind: gaming-content, version: 1, id: demo }\nclue_bank: charades/choices.yml\n');
    fs.unlinkSync(bank); fs.writeFileSync(path.join(root, 'outside.yml'), 'version: 1\nclues: []');
    fs.symlinkSync(path.join(root, 'outside.yml'), bank);
    expect(() => store.getCurrent('demo')).toThrow(/contained/i);
  });
});
