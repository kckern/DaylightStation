// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { resolveGameRules, buildCatalog } from './EmulatorCatalog.mjs';

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

describe('buildCatalog', () => {
  const baseCfg = {
    systems: { gbc: { core: 'gambatte', label: 'Game Boy Color' } },
    defaults: { governance: { mode: 'gate', required_zone: 'active', grace_seconds: 20, earn_rate: 1 }, shader: 'crt', chrome: null },
    games: [],
    users: {},
  };

  it('omits games with an unknown system and warns', () => {
    const logger = { warn: vi.fn(), info() {}, debug() {}, error() {} };
    const cfg = {
      ...baseCfg,
      games: [{ id: 'bad', system: 'snes', rom: 'b.sfc', title: 'Bad' }],
    };
    const out = buildCatalog(cfg, logger);
    expect(out.games).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith('emulator.catalog.unknown_system', { id: 'bad', system: 'snes' });
  });

  it('falls back to default earn_rate for a credit game missing earn_rate', () => {
    const cfg = {
      ...baseCfg,
      games: [{ id: 'c', system: 'gbc', rom: 'c.gbc', title: 'Credit',
                governance: { mode: 'credit', required_zone: 'warm' } }],
    };
    const out = buildCatalog(cfg);
    expect(out.games).toHaveLength(1);
    expect(out.games[0].governance.earn_rate).toBe(1);
  });

  it('passes a normal game through with boxart intact', () => {
    const cfg = {
      ...baseCfg,
      games: [{ id: 'pk', system: 'gbc', rom: 'pk.gbc', title: 'PK', boxart: 'art/pk.png' }],
    };
    const out = buildCatalog(cfg);
    expect(out.systems).toEqual(baseCfg.systems);
    expect(out.games).toHaveLength(1);
    expect(out.games[0].boxart).toBe('art/pk.png');
  });
});
