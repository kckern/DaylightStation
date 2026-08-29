#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { stableHash } from '../../shared/gaming/kernel/canonical.mjs';

const clone = (value) => structuredClone(value);
const PARTY_INPUTS = ['keyboard', 'gamepad', 'pointer', 'remote'];

function surface(id, presenter, authorityModes, inputs, rendererEmbeddings = []) {
  return {
    id, presenter, authority_modes: authorityModes, inputs,
    ...(rendererEmbeddings.length ? { renderer_embeddings: rendererEmbeddings } : {}),
  };
}

function migratedSurfaces(manifest, presenter, embeddings) {
  const legacy = manifest.native_surface_id;
  if (legacy === 'group-play' || legacy === 'party-game' || legacy === 'party-games') return [surface('party-games', presenter, ['remote'], PARTY_INPUTS, embeddings)];
  if (legacy === 'piano-game-platform') return [surface('piano', presenter, ['remote', 'checkpointed-local'], ['midi', 'keyboard', 'pointer'], embeddings)];
  if (legacy === 'gaming-app') {
    const renderer = manifest.id === 'card-battle' && embeddings.length === 0
      ? [{ id: 'presentation-v2', optional: true, projection: 'card-battle-scene', fallback_presenter: presenter }]
      : embeddings;
    return [
      surface('piano', presenter, ['remote'], ['midi', 'keyboard', 'pointer'], renderer),
      surface('developer', presenter, ['remote', 'ephemeral'], ['keyboard', 'gamepad', 'pointer'], renderer),
    ];
  }
  return [surface(legacy || 'developer', presenter, ['remote'], ['keyboard', 'pointer'], embeddings)];
}

function lifecycleCapabilities(manifest) {
  if (Array.isArray(manifest.lifecycle_capabilities)) return manifest.lifecycle_capabilities;
  const setup = manifest.setup?.kind;
  if (setup === 'teams') return ['participants', 'teams', 'scores'];
  if (setup === 'individuals-or-teams') return ['participants', 'teams', 'scores'];
  if (setup === 'individuals') return ['participants', 'scores'];
  return [];
}

export function migrateManifest(input) {
  const manifest = clone(input);
  if (manifest.schema_version === 2) {
    manifest.surfaces = (manifest.surfaces || []).map((entry) => ({
      ...entry,
      id: entry.id === 'group-play' || entry.id === 'party-game' ? 'party-games' : entry.id,
    }));
    manifest.result_schema ||= 'gaming-result/v1';
    return manifest;
  }
  const presenter = manifest.presenters?.primary;
  if (!presenter) throw new Error(`Legacy manifest ${manifest.id || '<unknown>'} has no primary presenter`);
  const embeddings = (manifest.renderer_embeddings || []).map((entry) => ({
    ...entry,
    projection: entry.projection || `${manifest.id}-scene`,
    ...(entry.optional === true ? { fallback_presenter: entry.fallback_presenter || presenter } : {}),
  }));
  const migrated = {
    ...manifest,
    schema_version: 2,
    surfaces: migratedSurfaces(manifest, presenter, embeddings),
    lifecycle_capabilities: lifecycleCapabilities(manifest),
    result_schema: 'gaming-result/v1',
  };
  delete migrated.native_surface_id;
  delete migrated.presenters;
  delete migrated.renderer_embeddings;
  delete migrated.hash;
  return migrated;
}

function launchSurface(nativeSurfaceId) {
  if (nativeSurfaceId === 'group-play' || nativeSurfaceId === 'party-game' || nativeSurfaceId === 'party-games') return 'party-games';
  if (nativeSurfaceId === 'gaming-app' || nativeSurfaceId === 'piano-game-platform') return 'piano';
  return nativeSurfaceId || 'developer';
}

export function migrateSessionHeader(input) {
  const header = clone(input);
  const nativeSurfaceId = header.experience?.native_surface_id;
  if (header.experience) delete header.experience.native_surface_id;
  header.launch ||= { surface_id: launchSurface(nativeSurfaceId), authority_mode: 'remote' };
  if (header.launch.surface_id === 'group-play' || header.launch.surface_id === 'party-game') header.launch.surface_id = 'party-games';
  return header;
}

export function migrateJournalText(text) {
  const records = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (!records[0]?.header) return text;
  records[0].header = migrateSessionHeader(records[0].header);
  const creation = { header: records[0].header, definition_id: records[0].definition_id, setup: records[0].setup || {} };
  records[0].checksum = stableHash(creation);
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function files(directory, pattern) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => path.join(directory, entry.name));
}

export function planGamingV2Migration(root) {
  const actions = [];
  const gaming = path.join(path.resolve(root), 'gaming');
  for (const file of files(path.join(gaming, 'manifests'), /\.ya?ml$/i)) {
    const before = fs.readFileSync(file, 'utf8');
    const after = YAML.stringify(migrateManifest(YAML.parse(before, { uniqueKeys: true })));
    if (after !== before) actions.push({ type: 'write', file, content: after, reason: 'experience-manifest-v2' });
  }
  for (const file of files(path.join(gaming, 'snapshots'), /\.ya?ml$/i)) {
    const before = fs.readFileSync(file, 'utf8');
    const snapshot = YAML.parse(before, { uniqueKeys: true });
    if (!snapshot?.header) continue;
    snapshot.header = migrateSessionHeader(snapshot.header);
    const after = YAML.stringify(snapshot);
    if (after !== before) actions.push({ type: 'write', file, content: after, reason: 'session-launch-context' });
  }
  for (const file of files(path.join(gaming, 'journals'), /\.jsonl$/i)) {
    const before = fs.readFileSync(file, 'utf8');
    const after = migrateJournalText(before);
    if (after !== before) actions.push({ type: 'write', file, content: after, reason: 'journal-launch-context' });
  }
  const partyConfig = path.join(gaming, 'party-games');
  const legacyConfigs = ['group-play', 'party-game'].map((name) => path.join(gaming, name)).filter((candidate) => fs.existsSync(candidate));
  if (legacyConfigs.length > 1) throw new Error(`Multiple legacy Party Games configs exist: ${legacyConfigs.join(', ')}`);
  if (legacyConfigs[0]) actions.push({ type: 'move', from: legacyConfigs[0], to: partyConfig, reason: 'party-games-config' });
  const scaleClashDirectory = path.join(gaming, 'games', 'scale-clash');
  if (fs.existsSync(scaleClashDirectory)) actions.push({
    type: 'move', from: scaleClashDirectory, to: path.join(gaming, 'archive', 'deprecated', 'scale-clash'), reason: 'deprecated-scale-clash',
  });
  for (const file of files(path.join(gaming, 'games'), /^scale-clash\.ya?ml$/i)) actions.push({
    type: 'move', from: file, to: path.join(gaming, 'archive', 'deprecated', path.basename(file)), reason: 'deprecated-scale-clash',
  });
  const legacyGameShow = path.join(gaming, 'gameshow');
  if (fs.existsSync(legacyGameShow)) actions.push({
    type: 'move', from: legacyGameShow, to: path.join(gaming, 'archive', 'history', 'game-show'), reason: 'historical-game-show',
  });
  return actions;
}

function backupPath(root, backupRoot, target) {
  const relative = path.relative(path.resolve(root), target);
  if (relative.startsWith('..')) throw new Error(`Migration target escapes root: ${target}`);
  return path.join(backupRoot, relative);
}

export function applyGamingV2Migration(root, actions, { backupName = `gaming-v1-${Date.now()}` } = {}) {
  const backupRoot = path.join(path.resolve(root), 'gaming', 'migration-backups', backupName);
  for (const action of actions) {
    const source = action.type === 'write' ? action.file : action.from;
    const backup = backupPath(root, backupRoot, source);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.cpSync(source, backup, { recursive: true, errorOnExist: true });
    if (action.type === 'write') {
      const temporary = `${action.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, action.content, { flag: 'wx' });
      fs.renameSync(temporary, action.file);
    } else {
      if (fs.existsSync(action.to)) throw new Error(`Migration destination already exists: ${action.to}`);
      fs.mkdirSync(path.dirname(action.to), { recursive: true });
      fs.renameSync(action.from, action.to);
    }
  }
  return backupRoot;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = argument('--root');
  if (!root) throw new Error('Usage: gaming-v2.mjs --root <household-root> [--apply]');
  const actions = planGamingV2Migration(root);
  const report = actions.map(({ content: _content, ...action }) => action);
  if (!process.argv.includes('--apply')) console.log(JSON.stringify({ mode: 'dry-run', actions: report }, null, 2));
  else console.log(JSON.stringify({ mode: 'applied', backup: applyGamingV2Migration(root, actions), actions: report }, null, 2));
}
