/**
 * The structured wire layer's config, from the `ai` entry of the household
 * integrations config: `ai: [{ provider: openai, wire: { mode, sample } }]`.
 * Absent or unrecognised → off, so the layer is inert until configured.
 */
const MODES = new Set(['off', 'input', 'full']);

export function readAiWireConfig(rawIntegrations) {
  const ai = rawIntegrations?.ai;
  const entries = Array.isArray(ai) ? ai : ai ? [ai] : [];
  const wire = entries.find((entry) => entry?.wire)?.wire ?? {};
  const mode = MODES.has(wire.mode) ? wire.mode : 'off';
  const sample = Number.isFinite(wire.sample) ? Math.min(1, Math.max(0, wire.sample)) : 1;
  return { mode, sample };
}
