import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import crypto from 'node:crypto';
import { canonicalStringify } from '#shared/gaming/kernel/canonical.mjs';

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const SETUP_KINDS = new Set(['none', 'individuals', 'teams', 'individuals-or-teams']);
const HOST_MODES = new Set(['human', 'computer', 'ai-assisted']);

const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

function validate(manifest, source) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error(`Gaming experience manifest must be an object: ${source}`);
  if (!ID.test(String(manifest.id || ''))) throw new Error(`Gaming experience manifest id is invalid: ${source}`);
  if (!Number.isInteger(manifest.version) || manifest.version < 1) throw new Error(`Gaming experience manifest version is invalid: ${source}`);
  if (!ID.test(String(manifest.native_surface_id || ''))) throw new Error(`Gaming native_surface_id is invalid: ${source}`);
  if (!ID.test(String(manifest.presenters?.primary || ''))) throw new Error(`Gaming primary presenter is invalid: ${source}`);
  if (!record(manifest.presenters) || Object.values(manifest.presenters).some((id) => !ID.test(String(id)))) throw new Error(`Gaming presenters are invalid: ${source}`);
  if (manifest.theme != null && !record(manifest.theme)) throw new Error(`Gaming theme must be an object: ${source}`);
  if (manifest.input_profile != null && !record(manifest.input_profile)) throw new Error(`Gaming input_profile must be an object: ${source}`);
  if (manifest.setup != null) {
    if (!record(manifest.setup) || !SETUP_KINDS.has(manifest.setup.kind)) throw new Error(`Gaming setup kind is invalid: ${source}`);
    if (manifest.setup.host_modes != null && (!Array.isArray(manifest.setup.host_modes) || manifest.setup.host_modes.some((mode) => !HOST_MODES.has(mode)))) throw new Error(`Gaming host modes are invalid: ${source}`);
    if (manifest.setup.verifier != null && manifest.setup.verifier !== 'opponent') throw new Error(`Gaming verifier policy is invalid: ${source}`);
  }
  if (manifest.renderer_embeddings != null) {
    if (!Array.isArray(manifest.renderer_embeddings) || manifest.renderer_embeddings.some((embedding) => !record(embedding) || !ID.test(String(embedding.id || '')) || (embedding.optional != null && typeof embedding.optional !== 'boolean'))) {
      throw new Error(`Gaming renderer embeddings are invalid: ${source}`);
    }
  }
  const authored = structuredClone(manifest);
  const hash = crypto.createHash('sha256').update(canonicalStringify(authored)).digest('hex');
  return Object.freeze({ ...authored, hash });
}

/** Mounted authored-artifact repository. Application source defines no experiences. */
export class YamlGamingExperienceManifestStore {
  constructor({ manifestsDir }) {
    if (!manifestsDir) throw new Error('manifestsDir is required');
    this.manifestsDir = manifestsDir;
    fs.mkdirSync(manifestsDir, { recursive: true });
  }

  list() {
    return fs.readdirSync(this.manifestsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => validate(YAML.parse(fs.readFileSync(path.join(this.manifestsDir, entry.name), 'utf8'), { uniqueKeys: true }), entry.name))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id, version = null) {
    if (!ID.test(String(id))) return null;
    return this.list().find((manifest) => manifest.id === id && (version == null || manifest.version === version)) || null;
  }
}
