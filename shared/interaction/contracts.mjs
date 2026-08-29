export const INTERACTION_PHASES = Object.freeze(['press', 'repeat', 'release', 'change']);
export const INTERACTION_SOURCES = Object.freeze(['keyboard', 'gamepad', 'pointer', 'stylus', 'touch', 'mouse', 'midi', 'sensor', 'remote']);

export const EXPERIENCE_MANIFEST_SCHEMA_VERSION = 2;
export const EXPERIENCE_AUTHORITY_MODES = Object.freeze(['remote', 'checkpointed-local', 'ephemeral']);
export const EXPERIENCE_LIFECYCLE_CAPABILITIES = Object.freeze([
  'participants', 'teams', 'scores', 'turns', 'rounds', 'deadlines',
]);

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const record = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function validateRenderer(renderer, surfaceId, errors) {
  if (!record(renderer) || !ID.test(String(renderer.id || ''))) {
    errors.push(`surface ${surfaceId} renderer id is invalid`);
    return;
  }
  if (renderer.optional != null && typeof renderer.optional !== 'boolean') {
    errors.push(`surface ${surfaceId} renderer ${renderer.id} optional must be boolean`);
  }
  if (!ID.test(String(renderer.projection || ''))) {
    errors.push(`surface ${surfaceId} renderer ${renderer.id} projection is invalid`);
  }
  if (renderer.fallback_presenter != null && !ID.test(String(renderer.fallback_presenter))) {
    errors.push(`surface ${surfaceId} renderer ${renderer.id} fallback presenter is invalid`);
  }
  if (renderer.optional === true && !renderer.fallback_presenter) {
    errors.push(`surface ${surfaceId} optional renderer ${renderer.id} requires fallback_presenter`);
  }
}

export function validateGameExperienceManifest(manifest) {
  const errors = [];
  if (!record(manifest)) return { valid: false, errors: ['manifest must be an object'] };
  if (manifest.schema_version !== EXPERIENCE_MANIFEST_SCHEMA_VERSION) errors.push(`schema_version must be ${EXPERIENCE_MANIFEST_SCHEMA_VERSION}`);
  if (!ID.test(String(manifest.id || ''))) errors.push('id is invalid');
  if (!Number.isInteger(manifest.version) || manifest.version < 1) errors.push('version must be a positive integer');
  if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length === 0) errors.push('surfaces must be a non-empty array');

  const surfaceIds = new Set();
  for (const surface of manifest.surfaces || []) {
    if (!record(surface) || !ID.test(String(surface.id || ''))) {
      errors.push('surface id is invalid');
      continue;
    }
    if (surfaceIds.has(surface.id)) errors.push(`surface id is duplicated: ${surface.id}`);
    surfaceIds.add(surface.id);
    if (!ID.test(String(surface.presenter || ''))) errors.push(`surface ${surface.id} presenter is invalid`);
    if (!Array.isArray(surface.authority_modes) || surface.authority_modes.length === 0
      || surface.authority_modes.some((mode) => !EXPERIENCE_AUTHORITY_MODES.includes(mode))) {
      errors.push(`surface ${surface.id} authority_modes are invalid`);
    }
    if (!Array.isArray(surface.inputs)
      || surface.inputs.some((source) => !INTERACTION_SOURCES.includes(source))) {
      errors.push(`surface ${surface.id} inputs are invalid`);
    }
    if (surface.renderer_embeddings != null) {
      if (!Array.isArray(surface.renderer_embeddings)) errors.push(`surface ${surface.id} renderer_embeddings must be an array`);
      else surface.renderer_embeddings.forEach((renderer) => validateRenderer(renderer, surface.id, errors));
    }
  }

  if (manifest.lifecycle_capabilities != null
    && (!Array.isArray(manifest.lifecycle_capabilities)
      || manifest.lifecycle_capabilities.some((capability) => !EXPERIENCE_LIFECYCLE_CAPABILITIES.includes(capability)))) {
    errors.push('lifecycle_capabilities are invalid');
  }
  if (manifest.result_schema !== 'gaming-result/v1') errors.push('result_schema must be gaming-result/v1');
  return { valid: errors.length === 0, errors };
}

export function interactionIntent({ action, phase = 'press', value = null, source, deviceType = source, controllerId = null, role = null, timestamp }) {
  if (typeof action !== 'string' || !action) throw new Error('InteractionIntent.action is required');
  if (!INTERACTION_PHASES.includes(phase)) throw new Error(`Unsupported interaction phase: ${phase}`);
  if (!INTERACTION_SOURCES.includes(source)) throw new Error(`Unsupported interaction source: ${source}`);
  if (!Number.isFinite(timestamp)) throw new Error('InteractionIntent.timestamp is required');
  return Object.freeze({ action, phase, value: structuredClone(value), source, device_type: deviceType, controller_id: controllerId, role_binding: role, timestamp });
}

export function gameExperienceManifest(manifest) {
  const validation = validateGameExperienceManifest(manifest);
  if (!validation.valid) throw new Error(`GameExperienceManifest: ${validation.errors.join('; ')}`);
  return Object.freeze(structuredClone(manifest));
}
