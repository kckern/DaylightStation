import { describe, it, expect } from 'vitest';
import {
  romBasename, overridePath, applyAutoLoad, planGameOverride, planAllGameOverrides,
} from './retroarchGameOverrides.mjs';

const config = {
  launch: { game_overrides: { device: 'livingroom-tv', config_dir: '/sd/RetroArch/config/' } },
  consoles: {
    gb: { core: 'gambatte_libretro_android.so', core_name: 'Gambatte' },
    genesis: { core: 'genesis_plus_gx_libretro_android.so', core_name: 'Genesis Plus GX' },
    nes: { core: 'fceumm_libretro_android.so' },
  },
};
const catalog = {
  games: {
    gb: [{ id: 'sml', title: 'Super Mario Land', rom: '/sd/Games/GB/Super Mario Land (JUE) (V1.1) [!].gb' }],
    genesis: [{ id: 'sonic', title: 'Sonic', rom: '/sd/Games/Genesis/Sonic the Hedgehog (JUE) [!].bin' }],
    nes: [{ id: 'bb', title: 'Bubble Bobble', rom: '/sd/Games/NES/Bubble Bobble (USA).nes' }],
  },
  overrides: { 'gb/sml': { resume: true }, 'genesis/sonic': { title: 'Sonic!' } },
};

describe('romBasename / overridePath', () => {
  it('strips directory and only the last extension', () => {
    expect(romBasename('/a/b/Pokemon - Crystal Version (UE) (V1.1) [C][!].gbc')).toBe('Pokemon - Crystal Version (UE) (V1.1) [C][!]');
    expect(romBasename("/a/Mega Man's Soccer.smc")).toBe("Mega Man's Soccer");
    expect(romBasename('/a/Super Mario Land (JUE) (V1.1) [!].gb')).toBe('Super Mario Land (JUE) (V1.1) [!]');
  });
  it('joins config dir, core name and basename', () => {
    expect(overridePath({ configDir: '/c/', coreName: 'Snes9x', rom: '/g/Tetris & Dr. Mario.smc' }))
      .toBe('/c/Snes9x/Tetris & Dr. Mario.cfg');
  });
});

describe('applyAutoLoad', () => {
  it('creates the key in an empty file', () => {
    expect(applyAutoLoad('', false)).toEqual({ text: 'savestate_auto_load = "false"\n', changed: true });
  });
  it('reports unchanged when the value already matches', () => {
    expect(applyAutoLoad('savestate_auto_load = "true"\n', true).changed).toBe(false);
  });
  it('flips the value and preserves every other key', () => {
    const { text, changed } = applyAutoLoad('input_player1_a = "x"\nsavestate_auto_load = "true"\nvideo_shader = "y"\n', false);
    expect(changed).toBe(true);
    expect(text).toBe('input_player1_a = "x"\nsavestate_auto_load = "false"\nvideo_shader = "y"\n');
  });
  it('collapses duplicate key lines to one', () => {
    const { text } = applyAutoLoad('savestate_auto_load = "true"\nsavestate_auto_load = "true"\n', true);
    expect(text).toBe('savestate_auto_load = "true"\n');
  });
  it('appends when other keys exist without it', () => {
    expect(applyAutoLoad('a = "1"', true).text).toBe('a = "1"\nsavestate_auto_load = "true"\n');
  });
});

describe('planGameOverride', () => {
  it('resume comes from catalog overrides; absent means false', () => {
    expect(planGameOverride({ config, catalog, consoleId: 'gb', gameId: 'sml' }).plan).toEqual({
      consoleId: 'gb', gameId: 'sml', title: 'Super Mario Land', resume: true,
      path: '/sd/RetroArch/config/Gambatte/Super Mario Land (JUE) (V1.1) [!].cfg',
    });
    const sonic = planGameOverride({ config, catalog, consoleId: 'genesis', gameId: 'sonic' }).plan;
    expect(sonic.resume).toBe(false);
    expect(sonic.path).toBe('/sd/RetroArch/config/Genesis Plus GX/Sonic the Hedgehog (JUE) [!].cfg');
  });
  it('skips with a reason when config is incomplete', () => {
    expect(planGameOverride({ config, catalog, consoleId: 'nes', gameId: 'bb' })).toEqual({ skip: 'no-core-name' });
    expect(planGameOverride({ config, catalog, consoleId: 'gb', gameId: 'nope' })).toEqual({ skip: 'unknown-game' });
    expect(planGameOverride({ config: { consoles: config.consoles }, catalog, consoleId: 'gb', gameId: 'sml' })).toEqual({ skip: 'no-config-dir' });
  });
  it('treats a truthy non-boolean resume as false', () => {
    const c = { ...catalog, overrides: { 'gb/sml': { resume: 'yes' } } };
    expect(planGameOverride({ config, catalog: c, consoleId: 'gb', gameId: 'sml' }).plan.resume).toBe(false);
  });
});

describe('planAllGameOverrides', () => {
  it('plans every catalog game and lists skips', () => {
    const { plans, skipped } = planAllGameOverrides({ config, catalog });
    expect(plans.map((p) => `${p.consoleId}/${p.gameId}:${p.resume}`)).toEqual(['gb/sml:true', 'genesis/sonic:false']);
    expect(skipped).toEqual([{ consoleId: 'nes', gameId: 'bb', reason: 'no-core-name' }]);
  });
});
