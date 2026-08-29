import path from 'node:path';
import YAML from 'yaml';
import crypto from 'node:crypto';
import { canonicalStringify } from '#shared/gaming/kernel/canonical.mjs';
import { ensureDir, readDirectory, readTextFromPath } from '#system/utils/FileIO.mjs';

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const SETUP_KINDS = new Set(['none', 'individuals', 'teams', 'individuals-or-teams']);
const HOST_MODES = new Set(['human', 'computer', 'ai-assisted']);
const AUTHORITY_MODES = new Set(['remote', 'checkpointed-local', 'ephemeral']);

const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

function validate(manifest, source) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error(`Gaming experience manifest must be an object: ${source}`);
  if (!ID.test(String(manifest.id || ''))) throw new Error(`Gaming experience manifest id is invalid: ${source}`);
  if (!Number.isInteger(manifest.version) || manifest.version < 1) throw new Error(`Gaming experience manifest version is invalid: ${source}`);
  if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length === 0) throw new Error(`Gaming surfaces are required: ${source}`);
  for (const surface of manifest.surfaces) {
    if (!record(surface) || !ID.test(String(surface.id || '')) || !ID.test(String(surface.presenter || ''))) throw new Error(`Gaming surface is invalid: ${source}`);
    if (!Array.isArray(surface.authority_modes) || surface.authority_modes.length === 0 || surface.authority_modes.some((mode) => !AUTHORITY_MODES.has(mode))) throw new Error(`Gaming surface authority_modes are invalid: ${source}`);
    if (!Array.isArray(surface.inputs) || surface.inputs.some((input) => typeof input !== 'string' || input === '')) throw new Error(`Gaming surface inputs are invalid: ${source}`);
    if (surface.renderer_embeddings != null && (!Array.isArray(surface.renderer_embeddings) || surface.renderer_embeddings.some((embedding) => !record(embedding) || !ID.test(String(embedding.id || '')) || (embedding.optional != null && typeof embedding.optional !== 'boolean')))) throw new Error(`Gaming renderer embeddings are invalid: ${source}`);
  }
  if (manifest.result_schema !== 'gaming-result/v1') throw new Error(`Gaming result_schema is invalid: ${source}`);
  if (manifest.theme != null && !record(manifest.theme)) throw new Error(`Gaming theme must be an object: ${source}`);
  if (manifest.input_profile != null && !record(manifest.input_profile)) throw new Error(`Gaming input_profile must be an object: ${source}`);
  if (manifest.setup != null) {
    if (!record(manifest.setup) || !SETUP_KINDS.has(manifest.setup.kind)) throw new Error(`Gaming setup kind is invalid: ${source}`);
    if (manifest.setup.host_modes != null && (!Array.isArray(manifest.setup.host_modes) || manifest.setup.host_modes.some((mode) => !HOST_MODES.has(mode)))) throw new Error(`Gaming host modes are invalid: ${source}`);
    if (manifest.setup.verifier != null && manifest.setup.verifier !== 'opponent') throw new Error(`Gaming verifier policy is invalid: ${source}`);
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
    ensureDir(manifestsDir);
  }

  list() {
    return readDirectory(this.manifestsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => validate(YAML.parse(readTextFromPath(path.join(this.manifestsDir, entry.name)), { uniqueKeys: true }), entry.name))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id, version = null) {
    if (!ID.test(String(id))) return null;
    return this.list().find((manifest) => manifest.id === id && (version == null || manifest.version === version)) || null;
  }
}
