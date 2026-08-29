import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { applyGamingV2Migration, migrateJournalText, migrateManifest, planGamingV2Migration } from './gaming-v2.mjs';
import { stableHash } from '../../shared/gaming/kernel/canonical.mjs';

test('migrates Card Battle to piano and developer surfaces with an optional Presentation V2 fallback', () => {
  const result = migrateManifest({ id: 'card-battle', version: 1, native_surface_id: 'gaming-app', presenters: { primary: 'card-battle' } });
  assert.deepEqual(result.surfaces.map((entry) => entry.id), ['piano', 'developer']);
  assert.deepEqual(result.surfaces[0].renderer_embeddings[0], {
    id: 'presentation-v2', optional: true, projection: 'card-battle-scene', fallback_presenter: 'card-battle',
  });
  assert.equal(result.result_schema, 'gaming-result/v1');
});

test('corrects the intermediate singular Party Games surface without a runtime alias', () => {
  const result = migrateManifest({
    schema_version: 2, id: 'jeopardy', version: 1,
    surfaces: [{ id: 'party-game', presenter: 'jeopardy-board', authority_modes: ['remote'], inputs: ['remote'] }],
    result_schema: 'gaming-result/v1',
  });
  assert.equal(result.surfaces[0].id, 'party-games');
});

test('rewrites journal launch context and its creation checksum', () => {
  const record = { kind: 'session-created', header: { session_id: 's1', experience: { id: 'card-battle', version: 1, native_surface_id: 'gaming-app', manifest_hash: 'a'.repeat(64) } }, definition_id: 'card-game', setup: {} };
  const migrated = JSON.parse(migrateJournalText(`${JSON.stringify({ ...record, checksum: 'old' })}\n`).trim());
  assert.equal(migrated.header.launch.surface_id, 'piano');
  assert.equal(migrated.header.experience.native_surface_id, undefined);
  assert.equal(migrated.checksum, stableHash({ header: migrated.header, definition_id: 'card-game', setup: {} }));
});

test('plans and applies only against an explicit copied root with recoverable backups', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gaming-v2-'));
  fs.mkdirSync(path.join(root, 'gaming', 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'gaming', 'group-play'), { recursive: true });
  fs.mkdirSync(path.join(root, 'gaming', 'games', 'scale-clash'), { recursive: true });
  fs.mkdirSync(path.join(root, 'gaming', 'gameshow', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'gaming', 'group-play', 'config.yml'), 'defaults: {}\n');
  fs.writeFileSync(path.join(root, 'gaming', 'games', 'scale-clash', 'rules.yml'), 'id: scale-clash\n');
  fs.writeFileSync(path.join(root, 'gaming', 'gameshow', 'sessions', 'old.yml'), 'id: old\n');
  fs.writeFileSync(path.join(root, 'gaming', 'manifests', 'dice.yml'), 'id: dice\nversion: 1\nnative_surface_id: group-play\npresenters: { primary: dice-table }\n');
  const actions = planGamingV2Migration(root);
  assert.deepEqual(actions.map((action) => action.reason).sort(), ['deprecated-scale-clash', 'experience-manifest-v2', 'historical-game-show', 'party-games-config']);
  const backup = applyGamingV2Migration(root, actions, { backupName: 'test' });
  const manifest = YAML.parse(fs.readFileSync(path.join(root, 'gaming', 'manifests', 'dice.yml'), 'utf8'));
  assert.equal(manifest.surfaces[0].id, 'party-games');
  assert.equal(fs.existsSync(path.join(root, 'gaming', 'party-games', 'config.yml')), true);
  assert.equal(fs.existsSync(path.join(root, 'gaming', 'archive', 'deprecated', 'scale-clash', 'rules.yml')), true);
  assert.equal(fs.existsSync(path.join(root, 'gaming', 'archive', 'history', 'game-show', 'sessions', 'old.yml')), true);
  assert.equal(fs.existsSync(path.join(backup, 'gaming', 'manifests', 'dice.yml')), true);
  fs.rmSync(root, { recursive: true, force: true });
});
