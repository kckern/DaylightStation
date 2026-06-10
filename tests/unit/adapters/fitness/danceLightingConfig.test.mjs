// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveDanceLightingConfig } from '#adapters/fitness/danceLightingConfig.mjs';

describe('resolveDanceLightingConfig', () => {
  it('applies all defaults when dance_party is absent', () => {
    expect(resolveDanceLightingConfig({})).toEqual({
      enabled: true, colorStrips: [], whiteLights: [], baseEffect: 'colorloop', partyModeFlag: null,
      accent: { mode: 'flash', onTrackChange: true, intervalMs: 20000, minIntervalMs: 4000 }
    });
  });

  it('reads configured values', () => {
    const cfg = resolveDanceLightingConfig({ dance_party: { lighting: {
      color_strips: ['light.a', 'light.b'], white_lights: ['light.w'], base_effect: 'colorloop',
      accent: { mode: 'breathe', on_track_change: false, interval_ms: 10000, min_interval_ms: 2000 }
    } } });
    expect(cfg.colorStrips).toEqual(['light.a', 'light.b']);
    expect(cfg.whiteLights).toEqual(['light.w']);
    expect(cfg.accent).toEqual({ mode: 'breathe', onTrackChange: false, intervalMs: 10000, minIntervalMs: 2000 });
  });

  it('enabled=false is honored; unknown accent mode falls back to flash', () => {
    expect(resolveDanceLightingConfig({ dance_party: { enabled: false } }).enabled).toBe(false);
    expect(resolveDanceLightingConfig({ dance_party: { lighting: { accent: { mode: 'nope' } } } }).accent.mode).toBe('flash');
  });

  it('parses party_mode_flag when configured, null otherwise', () => {
    const cfg = resolveDanceLightingConfig({ dance_party: { lighting: { party_mode_flag: 'input_boolean.garage_party_mode' } } });
    expect(cfg.partyModeFlag).toBe('input_boolean.garage_party_mode');
    expect(resolveDanceLightingConfig({}).partyModeFlag).toBe(null);
  });

  it('non-array strip config degrades to empty arrays', () => {
    const cfg = resolveDanceLightingConfig({ dance_party: { lighting: { color_strips: 'x', white_lights: null } } });
    expect(cfg.colorStrips).toEqual([]);
    expect(cfg.whiteLights).toEqual([]);
  });
});
