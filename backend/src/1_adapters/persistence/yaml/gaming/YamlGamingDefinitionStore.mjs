import crypto from 'node:crypto';
import path from 'node:path';
import YAML from 'yaml';
import { canonicalStringify } from '#shared/gaming/kernel/canonical.mjs';
import { ensureDir, fileExists, readDirectory, readTextFromPath, writeFileExclusive } from '#system/utils/FileIO.mjs';

const GAME_ID_RE = /^[a-z][a-z0-9:-]{0,127}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const ARTIFACT_KINDS = Object.freeze({ rules: 'gaming-rules', content: 'gaming-content' });

export class YamlGamingDefinitionStore {
  constructor({ definitionsDir, archiveDir, logger = null }) {
    this.definitionsDir = definitionsDir;
    this.archiveDir = archiveDir;
    this.logger = logger;
    ensureDir(this.definitionsDir);
    for (const dir of [this.archiveDir, this.#archiveDir('rules'), this.#archiveDir('content'), this.#archiveDir('bundles')]) ensureDir(dir);
  }

  #hash(definition) {
    return crypto.createHash('sha256').update(canonicalStringify(definition)).digest('hex');
  }

  #archiveDir(kind) {
    return path.join(this.archiveDir, kind);
  }

  #archiveFile(kind, hash) {
    if (!HASH_RE.test(String(hash))) return null;
    return path.join(this.#archiveDir(kind), `${hash}.yml`);
  }

  #readArtifact(file, label) {
    if (!fileExists(file)) return null;
    const value = YAML.parse(readTextFromPath(file), { uniqueKeys: true });
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value;
  }

  #validateArtifact(artifact, kind, gameId) {
    const metadata = artifact?.artifact;
    if (!metadata || metadata.kind !== ARTIFACT_KINDS[kind] || metadata.version !== 1 || metadata.id !== gameId) {
      throw new Error(`${kind} artifact ${gameId} must declare artifact { kind: ${ARTIFACT_KINDS[kind]}, version: 1, id: ${gameId} }`);
    }
    if (kind === 'rules' && (!artifact.rule_module?.id || !Number.isInteger(artifact.rule_module.version))) {
      throw new Error(`rules artifact ${gameId} must declare rule_module { id, version }`);
    }
    if (kind === 'rules' && (!artifact.experience?.id || !Number.isInteger(artifact.experience.version))) {
      throw new Error(`rules artifact ${gameId} must declare experience { id, version }`);
    }
  }

  #payload(artifact) {
    const { artifact: _metadata, ...payload } = artifact || {};
    return payload;
  }

  #compose(rulesArtifact, contentArtifact, gameId) {
    const rules = this.#payload(rulesArtifact);
    const content = this.#payload(contentArtifact);
    const collisions = Object.keys(content).filter((key) => Object.hasOwn(rules, key));
    if (collisions.length > 0) throw new Error(`definition ${gameId} repeats keys across rules.yml and content.yml: ${collisions.join(', ')}`);
    return { ...structuredClone(rules), ...structuredClone(content || {}) };
  }

  get(gameId) {
    if (!GAME_ID_RE.test(String(gameId))) return null;
    const root = path.join(this.definitionsDir, String(gameId));
    const rulesFile = path.join(root, 'rules.yml');
    const contentFile = path.join(root, 'content.yml');
    const rules = this.#readArtifact(rulesFile, `rules artifact ${gameId}`);
    if (!rules) return null;
    const content = this.#readArtifact(contentFile, `content artifact ${gameId}`);
    if (!content) throw new Error(`content artifact ${gameId} is required`);
    this.#validateArtifact(rules, 'rules', gameId);
    this.#validateArtifact(content, 'content', gameId);
    const rulesHash = this.#hash(rules);
    const contentHash = this.#hash(content);
    const hash = this.#hash({ rules_hash: rulesHash, content_hash: contentHash });
    return {
      definition: this.#compose(rules, content, gameId),
      hash,
      artifacts: {
        rules_definition: { id: gameId, hash: rulesHash },
        content_pack: { id: gameId, hash: contentHash },
      },
      parts: { rules: structuredClone(rules), content: structuredClone(content) },
      source: { rules: rulesFile, content: fileExists(contentFile) ? contentFile : null },
    };
  }

  getCurrent(gameId) {
    return this.get(gameId);
  }

  listIds({ prefix = null } = {}) {
    const expected = prefix == null ? null : `${String(prefix)}:`;
    if (prefix != null && !/^[a-z][a-z0-9-]*$/.test(String(prefix))) throw new Error(`invalid definition prefix: ${prefix}`);
    return readDirectory(this.definitionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && GAME_ID_RE.test(entry.name) && (!expected || entry.name.startsWith(expected)))
      .map((entry) => entry.name)
      .sort();
  }

  getContent(gameId) {
    const loaded = this.get(gameId);
    return loaded ? structuredClone(this.#payload(loaded.parts.content)) : null;
  }

  pin(loaded) {
    if (!loaded?.parts?.rules || !loaded?.parts?.content || !loaded?.artifacts) throw new Error('separate rules and content artifacts are required');
    const rules = structuredClone(loaded.parts.rules);
    const content = structuredClone(loaded.parts.content);
    const rulesHash = this.#hash(rules);
    const contentHash = this.#hash(content);
    const bundle = { rules_hash: rulesHash, content_hash: contentHash };
    const hash = this.#hash(bundle);
    for (const [kind, artifactHash, artifact] of [['rules', rulesHash, rules], ['content', contentHash, content], ['bundles', hash, bundle]]) {
      const file = this.#archiveFile(kind, artifactHash);
      if (!fileExists(file)) writeFileExclusive(file, YAML.stringify(artifact));
    }
    return { hash, definition: this.#compose(rules, content, loaded.artifacts.rules_definition.id), artifacts: structuredClone(loaded.artifacts) };
  }

  getPinned(hash) {
    const bundleFile = this.#archiveFile('bundles', hash);
    const bundle = bundleFile && this.#readArtifact(bundleFile, 'pinned definition bundle');
    if (!bundle || !HASH_RE.test(bundle.rules_hash) || !HASH_RE.test(bundle.content_hash) || this.#hash(bundle) !== hash) return null;
    const rules = this.#readArtifact(this.#archiveFile('rules', bundle.rules_hash), 'pinned rules artifact');
    const content = this.#readArtifact(this.#archiveFile('content', bundle.content_hash), 'pinned content artifact');
    if (!rules || !content || this.#hash(rules) !== bundle.rules_hash || this.#hash(content) !== bundle.content_hash) return null;
    return this.#compose(rules, content, hash);
  }
}
