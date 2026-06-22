// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveGameRules } from './EmulatorCatalog.mjs';

const cfg = {
  defaults: { governance: { mode: 'gate', required_zone: 'active', grace_seconds: 20, earn_rate: 1 }, shader: 'crt', chrome: null },
  games: [{ id: 'pkmn', system: 'gbc', rom: 'p.gbc', title: 'Pokémon',
            shader: 'lcd-grid', governance: { mode: 'credit', required_zone: 'warm', earn_rate: 1.5 } }],
  users: { soren: { governance: { required_zone: 'cool' } } },
};

describe('resolveGameRules', () => {
  it('merges defaults <- game with no user', () => {
    const r = resolveGameRules(cfg, 'pkmn', null);
    expect(r.governance).toEqual({ mode: 'credit', required_zone: 'warm', grace_seconds: 20, earn_rate: 1.5 });
    expect(r.shader).toBe('lcd-grid');
  });
  it('applies per-user overlay last', () => {
    const r = resolveGameRules(cfg, 'pkmn', 'soren');
    expect(r.governance.required_zone).toBe('cool');
    expect(r.governance.mode).toBe('credit');
  });
  it('returns null for unknown game', () => {
    expect(resolveGameRules(cfg, 'nope', null)).toBeNull();
  });
});
