import { describe, it, expect } from 'vitest';
import { resolveOverlayConfig } from './OverlaySessionFields.mjs';

const CONFIG = {
  defaults: { anchor: 'top-left', offset_x: '2%', offset_y: '2%', scale: 0.5, fields: ['player', 'system_label', 'timer'] },
  systems: {
    gbc: { scale: 0.4 },
    snes: { anchor: 'bottom-right', fields: ['player', 'timer'] },
    n64: { fields: [] },
  },
};

describe('resolveOverlayConfig', () => {
  it('returns pure defaults for a system with no override', () => {
    expect(resolveOverlayConfig(CONFIG, 'genesis')).toEqual({
      anchor: 'top-left', offsetX: '2%', offsetY: '2%', scale: 0.5,
      fields: ['player', 'system_label', 'timer'],
    });
  });

  it('overrides only the keys a system names, inheriting the rest', () => {
    const r = resolveOverlayConfig(CONFIG, 'gbc');
    expect(r.scale).toBe(0.4);
    expect(r.anchor).toBe('top-left');
    expect(r.fields).toEqual(['player', 'system_label', 'timer']);
  });

  it('lets a system drop a field while keeping others', () => {
    expect(resolveOverlayConfig(CONFIG, 'snes').fields).toEqual(['player', 'timer']);
  });

  it('treats an explicit empty fields list as "show nothing", not "inherit"', () => {
    expect(resolveOverlayConfig(CONFIG, 'n64').fields).toEqual([]);
  });

  it('falls back to safe built-in defaults when no config exists at all', () => {
    expect(resolveOverlayConfig(null, 'gb')).toEqual({
      anchor: 'top-left', offsetX: '2%', offsetY: '2%', scale: 0.5, fields: [],
    });
  });

  it('falls back to the config defaults for a system id with no matching entry', () => {
    expect(resolveOverlayConfig(CONFIG, 'nes').fields).toEqual(['player', 'system_label', 'timer']);
  });
});
