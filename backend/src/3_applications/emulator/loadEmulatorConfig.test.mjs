// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { loadEmulatorConfig } from './loadEmulatorConfig.mjs';
import { buildCatalog, resolveGameRules } from './EmulatorCatalog.mjs';

const gameboyManifest = {
  system: 'gb',
  label: 'Game Boy / Game Boy Color',
  core: { name: 'gambatte', ejs_core: 'gb', reference_so: 'core/gambatte.so' },
  defaults: {
    governance: { mode: 'gate', required_zone: 'active', grace_seconds: 20, earn_rate: 1.0, max_credit_seconds: 600 },
  },
  games: [
    {
      id: 'pokemon-red',
      title: 'Pokémon Red',
      rom: 'roms/Pokemon Red (UE) [S][!].gb',
      save: 'saves/Pokemon Red (UE) [S][!].srm',
      cover: 'cover.png',
      bezel: 'bezel.png',
      governance: { mode: 'credit', required_zone: 'warm', earn_rate: 1.5 },
      watches: [{ id: 'in_battle', addr: 0xD057, size: 1, when: { gt: 0 } }],
      hooks: [{ on: 'in_battle', do: { governance: { required_zone: 'hot' } } }],
    },
  ],
  presentation: { shader: 'dotmatrix', chrome: 'gb-bezel', core_options: {} },
  retroarch_reference: { should: 'be ignored' },
};

function makeLoader(manifests, opts = {}) {
  return loadEmulatorConfig({
    emulationDir: '/media/emulation',
    readManifests: () => manifests,
    logger: { warn() {}, info() {}, debug() {}, error() {} },
    ...opts,
  });
}

describe('loadEmulatorConfig', () => {
  it('normalizes systems with label + core', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    expect(cfg.systems.gb.label).toBe('Game Boy / Game Boy Color');
    expect(cfg.systems.gb.core).toBe('gb'); // ejs_core wins
  });

  it('falls back core to name then systemId', () => {
    const cfg = makeLoader([
      { system: 'nes', manifest: { system: 'nes', core: { name: 'fceumm' }, games: [] } },
      { system: 'snes', manifest: { system: 'snes', games: [] } },
    ]);
    expect(cfg.systems.nes.core).toBe('fceumm');
    expect(cfg.systems.snes.core).toBe('snes');
    expect(cfg.systems.snes.label).toBe('snes');
  });

  it('renames cover->boxart and carries rom/save/bezel/title/id', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    const game = cfg.games.find((g) => g.id === 'pokemon-red');
    expect(game.boxart).toBe('cover.png');
    expect(game.bezel).toBe('bezel.png');
    expect(game.rom).toBe('roms/Pokemon Red (UE) [S][!].gb');
    expect(game.save).toBe('saves/Pokemon Red (UE) [S][!].srm');
    expect(game.title).toBe('Pokémon Red');
    expect(game.system).toBe('gb');
  });

  it('merges system defaults UNDER game governance (game override wins)', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    const game = cfg.games.find((g) => g.id === 'pokemon-red');
    expect(game.governance.mode).toBe('credit'); // game override
    expect(game.governance.required_zone).toBe('warm'); // game override
    expect(game.governance.earn_rate).toBe(1.5); // game override
    expect(game.governance.grace_seconds).toBe(20); // from system defaults
    expect(game.governance.max_credit_seconds).toBe(600); // from system defaults
  });

  it('derives shader/chrome from presentation when game lacks them', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    const game = cfg.games.find((g) => g.id === 'pokemon-red');
    expect(game.shader).toBe('dotmatrix');
    expect(game.chrome).toBe('gb-bezel');
  });

  it('game shader/chrome override presentation', () => {
    const m = JSON.parse(JSON.stringify(gameboyManifest));
    m.games[0].shader = 'crt';
    m.games[0].chrome = 'custom';
    const cfg = makeLoader([{ system: 'gb', manifest: m }]);
    const game = cfg.games.find((g) => g.id === 'pokemon-red');
    expect(game.shader).toBe('crt');
    expect(game.chrome).toBe('custom');
  });

  it('carries watches and hooks through', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    const game = cfg.games.find((g) => g.id === 'pokemon-red');
    expect(game.watches).toHaveLength(1);
    expect(game.watches[0].id).toBe('in_battle');
    expect(game.hooks[0].on).toBe('in_battle');
  });

  it('sets global defaults fallback + empty users', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    expect(cfg.defaults).toEqual({ governance: {}, shader: null, chrome: null });
    expect(cfg.users).toEqual({});
  });

  it('includes input config from injected readInputConfig', () => {
    const input = { keyboard: { up: 'ArrowUp', a: 'x' }, controllers: [{ id: 'xbox', match: 'Xbox' }] };
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }], {
      readInputConfig: () => input,
    });
    expect(cfg.input).toEqual(input);
  });

  it('input defaults to null when no readInputConfig provided', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    expect(cfg.input).toBeNull();
  });

  it('input is null when readInputConfig returns null (absent file)', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }], {
      readInputConfig: () => null,
    });
    expect(cfg.input).toBeNull();
  });

  it('defaults saveMode to "none" when the game omits save_mode', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    const game = cfg.games.find((g) => g.id === 'pokemon-red');
    expect(game.saveMode).toBe('none');
  });

  it('carries save_mode through as saveMode', () => {
    const m = JSON.parse(JSON.stringify(gameboyManifest));
    m.games[0].save_mode = 'battery';
    const cfg = makeLoader([{ system: 'gb', manifest: m }]);
    expect(cfg.games.find((g) => g.id === 'pokemon-red').saveMode).toBe('battery');
  });

  it('per-game core override defaults null, carries through when set', () => {
    const base = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    expect(base.games[0].core).toBeNull();
    const m = JSON.parse(JSON.stringify(gameboyManifest));
    m.games[0].core = 'gba';
    const cfg = makeLoader([{ system: 'gb', manifest: m }]);
    expect(cfg.games[0].core).toBe('gba');
  });

  it('consoles defaults to [] without a readConsoles', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    expect(cfg.consoles).toEqual([]);
  });

  it('accepts a bare console list and a { consoles } wrapper', () => {
    const list = [{ system: 'gb', label: 'Game Boy' }, {}];
    const bare = makeLoader([{ system: 'gb', manifest: gameboyManifest }], { readConsoles: () => list });
    const wrapped = makeLoader([{ system: 'gb', manifest: gameboyManifest }], { readConsoles: () => ({ consoles: list }) });
    expect(bare.consoles).toEqual(list);
    expect(wrapped.consoles).toEqual(list);
  });

  it('manifest with no games contributes system but no games', () => {
    const cfg = makeLoader([{ system: 'snes', manifest: { system: 'snes', label: 'SNES' } }]);
    expect(cfg.systems.snes.label).toBe('SNES');
    expect(cfg.games).toEqual([]);
  });

  it('skips and logs a game with no id', () => {
    const logger = { warn: vi.fn(), info() {}, debug() {}, error() {} };
    const cfg = loadEmulatorConfig({
      emulationDir: '/media/emulation',
      readManifests: () => [{ system: 'gb', manifest: { system: 'gb', games: [{ title: 'no id' }, { id: 'ok', title: 'OK' }] } }],
      logger,
    });
    expect(cfg.games.map((g) => g.id)).toEqual(['ok']);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('output is consumable by buildCatalog + resolveGameRules', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    const { systems, games } = buildCatalog(cfg, { warn() {}, info() {}, debug() {}, error() {} });
    expect(systems.gb).toBeTruthy();
    expect(games).toHaveLength(1);
    const rules = resolveGameRules(cfg, 'pokemon-red', null);
    expect(rules.governance.mode).toBe('credit');
    expect(rules.governance.grace_seconds).toBe(20);
    expect(rules.shader).toBe('dotmatrix');
  });
});

describe('presentation passthrough (bezel hotspots + overlays)', () => {
  const withPresentation = {
    ...gameboyManifest,
    presentation: {
      shader: 'dotmatrix',
      chrome: 'gb-bezel',
      screen: { x: 29, y: 10, width: 41, height: 66 },
      hotspots: [{ id: 'speaker', action: 'volume', region: { x: 79, y: 64, width: 12, height: 22 } }],
      overlays: [{ id: 'hr', source: 'fitness.heart_rate', format: 'bpm', region: { x: 15, y: 43, width: 12, height: 16 } }],
    },
    games: [
      {
        id: 'pokemon-red',
        title: 'Pokémon Red',
        rom: 'roms/red.gb',
        governance: { mode: 'credit' },
        // per-game override: add a badge overlay
        presentation: {
          overlays: [{ id: 'badges', source: 'state.badges', format: 'badge_meter', region: { x: 71, y: 33, width: 12, height: 10 } }],
        },
      },
    ],
  };

  it('attaches the system presentation (screen/hotspots/overlays) to each game, game-merged', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: withPresentation }]);
    const game = cfg.games.find((g) => g.id === 'pokemon-red');
    expect(game.presentation.screen).toEqual({ x: 29, y: 10, width: 41, height: 66 });
    expect(game.presentation.hotspots.map((h) => h.id)).toEqual(['speaker']);
    // system 'hr' overlay + game 'badges' overlay both present
    expect(game.presentation.overlays.map((o) => o.id).sort()).toEqual(['badges', 'hr']);
  });

  it('resolveGameRules exposes the merged presentation to the browser catalog', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: withPresentation }]);
    const resolved = resolveGameRules(cfg, 'pokemon-red', null);
    expect(resolved.presentation.hotspots[0].id).toBe('speaker');
    expect(resolved.presentation.overlays.map((o) => o.id).sort()).toEqual(['badges', 'hr']);
  });
});
