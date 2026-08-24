export const INTERACTION_PHASES = Object.freeze(['press', 'repeat', 'release', 'change']);
export const INTERACTION_SOURCES = Object.freeze(['keyboard', 'gamepad', 'pointer', 'stylus', 'touch', 'mouse', 'midi', 'sensor', 'remote']);

export function interactionIntent({ action, phase = 'press', value = null, source, deviceType = source, controllerId = null, role = null, timestamp }) {
  if (typeof action !== 'string' || !action) throw new Error('InteractionIntent.action is required');
  if (!INTERACTION_PHASES.includes(phase)) throw new Error(`Unsupported interaction phase: ${phase}`);
  if (!INTERACTION_SOURCES.includes(source)) throw new Error(`Unsupported interaction source: ${source}`);
  if (!Number.isFinite(timestamp)) throw new Error('InteractionIntent.timestamp is required');
  return Object.freeze({ action, phase, value: structuredClone(value), source, device_type: deviceType, controller_id: controllerId, role_binding: role, timestamp });
}

export function gameExperienceManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('GameExperienceManifest is required');
  if (!manifest.id || !manifest.version || !manifest.native_surface_id) throw new Error('Experience manifest requires id, version, and native_surface_id');
  return Object.freeze({
    id: manifest.id,
    version: manifest.version,
    native_surface_id: manifest.native_surface_id,
    theme: structuredClone(manifest.theme || {}),
    input_profile: structuredClone(manifest.input_profile || {}),
    presenters: structuredClone(manifest.presenters || {}),
    renderer_embeddings: structuredClone(manifest.renderer_embeddings || []),
  });
}
