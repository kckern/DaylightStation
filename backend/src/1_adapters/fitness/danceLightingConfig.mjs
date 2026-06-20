/**
 * Resolve the dance_party.lighting config into a normalized shape with fallbacks.
 * Config-driven with graceful degradation: absent config never throws, and a
 * missing capability (e.g. no color_strips) degrades to a no-op downstream.
 */
const ACCENT_MODES = ['flash', 'breathe', 'blink'];

// Smart plugs configured by bare name (e.g. `garage_disco_light_plug`) are
// normalized to the HA `switch.` domain, matching GarageFanAdapter's convention.
// A name that already carries a domain (has a `.`) is passed through untouched.
function normalizePlug(id) {
  if (id == null) return null;
  const s = String(id).trim();
  if (!s) return null;
  return s.includes('.') ? s : `switch.${s}`;
}

export function resolveDanceLightingConfig(fitnessConfig) {
  const dp = fitnessConfig?.dance_party || {};
  const lighting = dp.lighting || {};
  const accent = lighting.accent || {};
  return {
    enabled: dp.enabled !== false,
    colorStrips: Array.isArray(lighting.color_strips) ? lighting.color_strips : [],
    whiteLights: Array.isArray(lighting.white_lights) ? lighting.white_lights : [],
    // Smart plugs (switch domain) turned ON with the party and OFF when it ends
    // (e.g. the disco light plug). Independent of the Hue color strips.
    plugs: (Array.isArray(lighting.plugs) ? lighting.plugs : []).map(normalizePlug).filter(Boolean),
    baseEffect: typeof lighting.base_effect === 'string' && lighting.base_effect ? lighting.base_effect : 'colorloop',
    partyModeFlag: typeof lighting.party_mode_flag === 'string' && lighting.party_mode_flag ? lighting.party_mode_flag : null,
    // input_number entity that mirrors the music's live BPM for HA-side strobe
    // scripts; null → setBpm degrades to a no-op.
    bpmEntity: typeof lighting.bpm_entity === 'string' && lighting.bpm_entity ? lighting.bpm_entity : null,
    bpmMinIntervalMs: Number.isFinite(lighting.bpm_min_interval_ms) ? lighting.bpm_min_interval_ms : 2000,
    accent: {
      mode: ACCENT_MODES.includes(accent.mode) ? accent.mode : 'flash',
      onTrackChange: accent.on_track_change !== false,
      intervalMs: Number.isFinite(accent.interval_ms) ? accent.interval_ms : 20000,
      minIntervalMs: Number.isFinite(accent.min_interval_ms) ? accent.min_interval_ms : 4000
    }
  };
}
