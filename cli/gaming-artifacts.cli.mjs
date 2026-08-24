#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { canonicalStringify } from '../shared/gaming/kernel/canonical.mjs';
import { activityPartyRuleModule } from '../shared/gaming/rulesets/activity-party/index.mjs';
import { cardBattleRuleModule } from '../shared/gaming/rulesets/card-battle/index.mjs';
import { checkersRuleModule } from '../shared/gaming/rulesets/checkers/index.mjs';
import { chessRuleModule } from '../shared/gaming/rulesets/chess/index.mjs';
import { connectFourRuleModule } from '../shared/gaming/rulesets/connect-four/index.mjs';
import { diceRuleModule } from '../shared/gaming/rulesets/dice/index.mjs';
import { jeopardyRuleModule } from '../shared/gaming/rulesets/jeopardy/index.mjs';
import { selectorRuleModule } from '../shared/gaming/rulesets/selector/index.mjs';

const ID = /^[a-z][a-z0-9:-]{0,127}$/;
const RULE_MODULES = new Map([
  activityPartyRuleModule,
  cardBattleRuleModule,
  checkersRuleModule,
  chessRuleModule,
  connectFourRuleModule,
  diceRuleModule,
  jeopardyRuleModule,
  selectorRuleModule,
].map((module) => [`${module.id}@${module.version}`, module]));

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readObject(file, label) {
  if (!file) throw new Error(`${label} source is required`);
  const parsed = YAML.parse(fs.readFileSync(path.resolve(file), 'utf8'), { uniqueKeys: true });
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be a YAML object`);
  return parsed;
}

function atomicYaml(file, artifact) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, YAML.stringify(artifact), { flag: 'wx' });
  fs.renameSync(temporary, file);
}

function assertArtifact(artifact, { id, kind }) {
  const expectedKind = kind === 'rules' ? 'gaming-rules' : 'gaming-content';
  if (artifact?.artifact?.kind !== expectedKind || artifact.artifact.version !== 1 || artifact.artifact.id !== id) {
    throw new Error(`${kind} must declare artifact { kind: ${expectedKind}, version: 1, id: ${id} }`);
  }
  if (kind === 'rules' && (!ID.test(String(artifact.rule_module?.id || '')) || !Number.isInteger(artifact.rule_module?.version))) {
    throw new Error('rules must declare rule_module { id, version }');
  }
  if (kind === 'rules' && (!ID.test(String(artifact.experience?.id || '')) || !Number.isInteger(artifact.experience?.version))) {
    throw new Error('rules must declare experience { id, version }');
  }
}

export function installBundle({ dataDir, id, rulesFile, contentFile }) {
  if (!dataDir || !ID.test(String(id))) throw new Error('A safe --data-dir and --id are required');
  const rules = readObject(rulesFile, 'rules');
  const content = readObject(contentFile, 'content');
  assertArtifact(rules, { id, kind: 'rules' });
  assertArtifact(content, { id, kind: 'content' });
  const collisions = Object.keys(content).filter((key) => key !== 'artifact' && Object.hasOwn(rules, key));
  if (collisions.length > 0) throw new Error(`rules/content keys overlap: ${collisions.join(', ')}`);
  const target = path.join(path.resolve(dataDir), 'household', 'gaming', 'games', id);
  atomicYaml(path.join(target, 'rules.yml'), rules);
  atomicYaml(path.join(target, 'content.yml'), content);
  return target;
}

export function installManifest({ dataDir, sourceFile }) {
  if (!dataDir) throw new Error('--data-dir is required');
  const manifest = readObject(sourceFile, 'manifest');
  if (!ID.test(String(manifest.id || '')) || !Number.isInteger(manifest.version) || !ID.test(String(manifest.native_surface_id || '')) || !ID.test(String(manifest.presenters?.primary || ''))) throw new Error('manifest id, version, native_surface_id, and presenters.primary are required');
  const target = path.join(path.resolve(dataDir), 'household', 'gaming', 'manifests', `${manifest.id}.yml`);
  atomicYaml(target, manifest);
  return target;
}

const hash = (value) => crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
const payload = (artifact) => {
  const { artifact: _metadata, ...rest } = artifact;
  return rest;
};

/** Read-only verification of one mounted rules/content pair. */
export function verifyBundle({ dataDir, id }) {
  if (!dataDir || !ID.test(String(id))) throw new Error('A safe --data-dir and game id are required');
  const target = path.join(path.resolve(dataDir), 'household', 'gaming', 'games', id);
  const rules = readObject(path.join(target, 'rules.yml'), 'rules');
  const content = readObject(path.join(target, 'content.yml'), 'content');
  assertArtifact(rules, { id, kind: 'rules' });
  assertArtifact(content, { id, kind: 'content' });
  const collisions = Object.keys(payload(content)).filter((key) => Object.hasOwn(payload(rules), key));
  if (collisions.length > 0) throw new Error(`rules/content keys overlap: ${collisions.join(', ')}`);
  const definition = { ...payload(rules), ...payload(content) };
  const reference = rules.rule_module;
  const module = RULE_MODULES.get(`${reference.id}@${reference.version}`);
  if (!module) throw new Error(`unsupported rule module: ${reference.id}@${reference.version}`);
  const validated = module.validateDefinition(definition);
  if (!validated.valid) throw new Error(`invalid ${reference.id} definition: ${validated.errors.join('; ')}`);
  const rulesHash = hash(rules);
  const contentHash = hash(content);
  return {
    valid: true,
    id,
    rule_module: { id: module.id, version: module.version },
    rules_hash: rulesHash,
    content_hash: contentHash,
    definition_hash: hash({ rules_hash: rulesHash, content_hash: contentHash }),
    source: target,
  };
}

function defaultDataDir() {
  if (process.env.DAYLIGHT_DATA_PATH) return process.env.DAYLIGHT_DATA_PATH;
  if (process.env.DAYLIGHT_BASE_PATH) return path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  return null;
}

function main() {
  const command = process.argv[2];
  if (command === 'install-bundle') {
    installBundle({ dataDir: value('--data-dir'), id: value('--id'), rulesFile: value('--rules'), contentFile: value('--content') });
  } else if (command === 'install-manifest') {
    installManifest({ dataDir: value('--data-dir'), sourceFile: value('--source') });
  } else if (command === 'verify') {
    try {
      const result = verifyBundle({ dataDir: value('--data-dir') || defaultDataDir(), id: process.argv[3] });
      process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : `✓ ${result.id} ${result.definition_hash}\n`);
    } catch (error) {
      process.stderr.write(`✗ ${error.message}\n`);
      process.exitCode = 1;
    }
  } else {
    process.stderr.write('Usage: gaming-artifacts.cli.mjs install-bundle --data-dir DIR --id ID --rules FILE --content FILE\n       gaming-artifacts.cli.mjs install-manifest --data-dir DIR --source FILE\n       gaming-artifacts.cli.mjs verify GAME_ID [--data-dir DIR] [--json]\n');
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
