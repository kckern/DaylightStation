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
      id: 'example-quest',
      title: 'Example Quest',
      rom: 'roms/Example Quest (UE) [S][!].gb',
      save: 'saves/Example Quest (UE) [S][!].srm',
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
    const game = cfg.games.find((g) => g.id === 'example-quest');
    expect(game.boxart).toBe('cover.png');
    expect(game.bezel).toBe('bezel.png');
    expect(game.rom).toBe('roms/Example Quest (UE) [S][!].gb');
    expect(game.save).toBe('saves/Example Quest (UE) [S][!].srm');
    expect(game.title).toBe('Example Quest');
    expect(game.system).toBe('gb');
  });

  it('merges system defaults UNDER game governance (game override wins)', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    const game = cfg.games.find((g) => g.id === 'example-quest');
    expect(game.governance.mode).toBe('credit'); // game override
    expect(game.governance.required_zone).toBe('warm'); // game override
    expect(game.governance.earn_rate).toBe(1.5); // game override
    expect(game.governance.grace_seconds).toBe(20); // from system defaults
    expect(game.governance.max_credit_seconds).toBe(600); // from system defaults
  });

  it('derives shader/chrome from presentation when game lacks them', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    const game = cfg.games.find((g) => g.id === 'example-quest');
    expect(game.shader).toBe('dotmatrix');
    expect(game.chrome).toBe('gb-bezel');
  });

  it('game shader/chrome override presentation', () => {
    const m = JSON.parse(JSON.stringify(gameboyManifest));
    m.games[0].shader = 'crt';
    m.games[0].chrome = 'custom';
    const cfg = makeLoader([{ system: 'gb', manifest: m }]);
    const game = cfg.games.find((g) => g.id === 'example-quest');
    expect(game.shader).toBe('crt');
    expect(game.chrome).toBe('custom');
  });

  it('carries watches and hooks through', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    const game = cfg.games.find((g) => g.id === 'example-quest');
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
    const game = cfg.games.find((g) => g.id === 'example-quest');
    expect(game.saveMode).toBe('none');
  });

  it('carries save_mode through as saveMode', () => {
    const m = JSON.parse(JSON.stringify(gameboyManifest));
    m.games[0].save_mode = 'battery';
    const cfg = makeLoader([{ system: 'gb', manifest: m }]);
    expect(cfg.games.find((g) => g.id === 'example-quest').saveMode).toBe('battery');
  });

  it('defaults the bezel to the shared system asset when a game omits it', () => {
    const m = JSON.parse(JSON.stringify(gameboyManifest));
    delete m.games[0].bezel; // game without its own bezel
    m.games.push({ id: 'mk', title: 'Mario Kart', rom: 'roms/mk.gba', core: 'gba' });
    const cfg = makeLoader([{ system: 'gb', manifest: m }]);
    // Both the un-bezeled original game and the new one inherit the system bezel.
    expect(cfg.games.find((g) => g.id === 'example-quest').bezel).toBe('bezel.png');
    expect(cfg.games.find((g) => g.id === 'mk').bezel).toBe('bezel.png');
  });

  it('honors a system-level manifest.bezel and a per-game bezel override', () => {
    const m = JSON.parse(JSON.stringify(gameboyManifest));
    m.bezel = 'system-bezel.png';
    delete m.games[0].bezel;
    m.games.push({ id: 'special', title: 'Special', rom: 'r.gb', bezel: 'special-bezel.png' });
    const cfg = makeLoader([{ system: 'gb', manifest: m }]);
    expect(cfg.games.find((g) => g.id === 'example-quest').bezel).toBe('system-bezel.png'); // system default
    expect(cfg.games.find((g) => g.id === 'special').bezel).toBe('special-bezel.png');    // per-game override
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

  it('defaults native resolution to 160×144 for a gb-core game', () => {
    const cfg = loadEmulatorConfig({ emulationDir: '/x', readManifests: () => ([
      { system: 'gb', manifest: { system: 'gb', core: { ejs_core: 'gb' }, games: [{ id: 'pkmn', rom: 'r.gb' }] } },
    ]) });
    expect(cfg.games[0].native).toEqual({ width: 160, height: 144 });
  });

  it('auto-defaults native resolution to 240×160 for a per-game gba core', () => {
    const cfg = loadEmulatorConfig({ emulationDir: '/x', readManifests: () => ([
      { system: 'gb', manifest: { system: 'gb', core: { ejs_core: 'gb' }, games: [
        { id: 'msc', rom: 'msc.gba', core: 'gba' },
      ] } },
    ]) });
    expect(cfg.games[0].native).toEqual({ width: 240, height: 160 });
  });

  it('honors an explicit per-game native override over the core default', () => {
    const cfg = loadEmulatorConfig({ emulationDir: '/x', readManifests: () => ([
      { system: 'gb', manifest: { system: 'gb', core: { ejs_core: 'gb' }, games: [
        { id: 'odd', rom: 'odd.gb', native: { width: 256, height: 224 } },
      ] } },
    ]) });
    expect(cfg.games[0].native).toEqual({ width: 256, height: 224 });
  });

  it('honors a system-level native default when no per-game core/native', () => {
    const cfg = loadEmulatorConfig({ emulationDir: '/x', readManifests: () => ([
      { system: 'gba', manifest: { system: 'gba', core: { ejs_core: 'gba' }, native: { width: 240, height: 160 }, games: [{ id: 'g', rom: 'g.gba' }] } },
    ]) });
    expect(cfg.games[0].native).toEqual({ width: 240, height: 160 });
    expect(cfg.systems.gba.native).toEqual({ width: 240, height: 160 });
  });

  it('output is consumable by buildCatalog + resolveGameRules', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: gameboyManifest }]);
    const { systems, games } = buildCatalog(cfg, { warn() {}, info() {}, debug() {}, error() {} });
    expect(systems.gb).toBeTruthy();
    expect(games).toHaveLength(1);
    const rules = resolveGameRules(cfg, 'example-quest', null);
    expect(rules.governance.mode).toBe('credit');
    expect(rules.governance.grace_seconds).toBe(20);
    expect(rules.shader).toBe('dotmatrix');
  });
});

describe('settings', () => {
  it('defaults when readSettings returns null', () => {
    const cfg = loadEmulatorConfig({ emulationDir: '/x', readManifests: () => [], readSettings: () => null });
    expect(cfg.settings).toEqual({ autosaveSeconds: 15, idleRelockMinutes: 10, adminGate: true });
  });

  it('takes provided values and coerces adminGate:false', () => {
    const cfg = loadEmulatorConfig({
      emulationDir: '/x',
      readManifests: () => [],
      readSettings: () => ({ autosaveSeconds: 30, idleRelockMinutes: 5, adminGate: false }),
    });
    expect(cfg.settings).toEqual({ autosaveSeconds: 30, idleRelockMinutes: 5, adminGate: false });
  });

  // A test override once left `adminGate: false` in the live settings file and
  // the arcade opened to everyone for a day with nothing in the log to say so.
  it('warns whenever the admin gate is configured off, and never when it is on', () => {
    const warn = vi.fn();
    const logger = { warn, info() {}, debug() {}, error() {} };
    loadEmulatorConfig({ emulationDir: '/x', readManifests: () => [], readSettings: () => ({ adminGate: false }), logger });
    expect(warn).toHaveBeenCalledWith('emulator.config.admin_gate_disabled', { emulationDir: '/x' });
    warn.mockClear();
    loadEmulatorConfig({ emulationDir: '/x', readManifests: () => [], readSettings: () => null, logger });
    expect(warn).not.toHaveBeenCalledWith('emulator.config.admin_gate_disabled', expect.anything());
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
        id: 'example-quest',
        title: 'Example Quest',
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
    const game = cfg.games.find((g) => g.id === 'example-quest');
    expect(game.presentation.screen).toEqual({ x: 29, y: 10, width: 41, height: 66 });
    expect(game.presentation.hotspots.map((h) => h.id)).toEqual(['speaker']);
    // system 'hr' overlay + game 'badges' overlay both present
    expect(game.presentation.overlays.map((o) => o.id).sort()).toEqual(['badges', 'hr']);
  });

  it('resolveGameRules exposes the merged presentation to the browser catalog', () => {
    const cfg = makeLoader([{ system: 'gb', manifest: withPresentation }]);
    const resolved = resolveGameRules(cfg, 'example-quest', null);
    expect(resolved.presentation.hotspots[0].id).toBe('speaker');
    expect(resolved.presentation.overlays.map((o) => o.id).sort()).toEqual(['badges', 'hr']);
  });
});

describe('regions over the picture', () => {
  const screen = { x: 20, y: 10, width: 60, height: 80 };   // picture: x 20..80, y 10..90
  const load = (presentation, logger) => loadEmulatorConfig({
    emulationDir: '/e',
    readManifests: () => [{ system: 'genesis', manifest: {
      system: 'genesis', label: 'Genesis', core: { ejs_core: 'segaMD' },
      games: [{ id: 'g', rom: 'r.bin' }], presentation,
    } }],
    logger,
  });
  const warned = (logger) => (logger.warn.mock.calls || [])
    .filter((c) => c[0] === 'emulator.config.region_over_screen')
    .map((c) => `${c[1].kind}:${c[1].id}`);

  const mkLogger = () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() });

  it('warns about an overlay that has crept onto the game', () => {
    const logger = mkLogger();
    load({ screen, overlays: [{ id: 'coins', region: { x: 33, y: 85, width: 11, height: 10 } }] }, logger);
    expect(warned(logger)).toEqual(['overlay:coins']);
  });

  it('stays quiet for regions in the margin', () => {
    const logger = mkLogger();
    load({ screen, overlays: [{ id: 'timer', region: { x: 0, y: 0, width: 17, height: 9 } }] }, logger);
    expect(warned(logger)).toEqual([]);
  });

  it('ignores a decorative hotspot, which renders no target at all', () => {
    // HotspotLayer only draws hotspots carrying an action or a `do:` block.
    // Several documented-but-inert regions already sit a hair over a screen
    // edge; warning about them would make this alarm permanent and useless.
    const logger = mkLogger();
    load({ screen, hotspots: [{ id: 'stripe', region: { x: 30, y: 8, width: 7, height: 5 } }] }, logger);
    expect(warned(logger)).toEqual([]);
  });

  it('does warn about an ACTIONABLE hotspot on the game', () => {
    const logger = mkLogger();
    load({ screen, hotspots: [{ id: 'exit', action: 'exit', region: { x: 30, y: 40, width: 7, height: 5 } }] }, logger);
    expect(warned(logger)).toEqual(['hotspot:exit']);
  });

  it('says nothing when a system declares no screen', () => {
    const logger = mkLogger();
    load({ overlays: [{ id: 'x', region: { x: 0, y: 0, width: 10, height: 10 } }] }, logger);
    expect(warned(logger)).toEqual([]);
  });
});

describe('aperture vs drawn screen', () => {
  const mkLogger = () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() });
  const load = (presentation, logger) => loadEmulatorConfig({
    emulationDir: '/e',
    readManifests: () => [{ system: 'genesis', manifest: {
      system: 'genesis', label: 'G', core: { ejs_core: 'segaMD' },
      games: [{ id: 'g', rom: 'r.bin' }], presentation,
    } }],
    logger,
  });
  const warned = (l) => (l.warn.mock.calls || []).filter((c) => c[0] === 'emulator.config.region_over_screen').length;

  it('judges regions against the visible hole, not the overhanging picture', () => {
    // The Genesis draws its picture wider than the hole so the bezel's notches
    // fall on it. A chip on the console body sits over that overhang — and over
    // the chrome that hides it — which is correct, not a fault.
    const logger = mkLogger();
    load({
      screen: { x: 13.958, y: 1.944, width: 72.083, height: 96.111 },
      aperture: { x: 18.281, y: 1.944, width: 63.438, height: 96.111 },
      overlays: [{ id: 'timer', region: { x: 4.167, y: 17.593, width: 11.979, height: 11.111 } }],
    }, logger);
    expect(warned(logger)).toBe(0);
  });

  it('still catches a chip inside the hole itself', () => {
    const logger = mkLogger();
    load({
      screen: { x: 13.958, y: 1.944, width: 72.083, height: 96.111 },
      aperture: { x: 18.281, y: 1.944, width: 63.438, height: 96.111 },
      overlays: [{ id: 'coins', region: { x: 40, y: 40, width: 10, height: 10 } }],
    }, logger);
    expect(warned(logger)).toBe(1);
  });
});
