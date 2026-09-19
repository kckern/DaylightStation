import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createArcadeGameSessionTracking, buildBezelTable } from './arcadeGameSessions.mjs';

const quiet = { info() {}, warn() {}, debug() {}, error() {} };
const httpClient = { get: async () => ({ status: 200, data: {} }) };
const configService = {
  getHouseholdAuth: (ref) => (ref === 'fullykiosk' ? { password: 'pw' } : null),
  getHouseholdPath: (rel) => `/tmp/test-data/${rel}`,
};
const gamesConfig = { launch: { package: 'com.example.emulator' } };

const metered = {
  arcade_session_observation: true,
  content_control: {
    provider: 'fully-kiosk', host: '10.0.0.9', port: 2323, auth_ref: 'fullykiosk',
    fallback: { provider: 'adb', host: '10.0.0.9', port: 5555 },
  },
};
const notMetered = { content_control: { provider: 'fully-kiosk', host: '10.0.0.8', port: 2323 } };

const build = (devices, over = {}) => createArcadeGameSessionTracking({
  devicesConfig: { devices }, gamesConfig, configService, eventBus: { broadcast() {} },
  httpClient, scheduler: { after: () => () => {} }, now: () => new Date().toISOString(),
  logger: quiet, ...over,
});

describe('arcade-game-session wiring is opt-in per device', () => {
  it('keeps push-ingress recording available when no polled device declares it', async () => {
    const r = build({ 'art-panel': notMetered, 'office-pc': notMetered });
    expect(r.trackers).toHaveLength(0);
    expect(r.sessions).not.toBeNull();
    expect(r.recordObservation).not.toBeNull();
    await expect(r.start()).resolves.not.toThrow();
  });

  it('settles a silent browser-only session and broadcasts its ending', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-browser-session-monitor-'));
    const events = [];
    let clock = '2026-09-12T20:00:00.000Z';
    try {
      const r = createArcadeGameSessionTracking({
        devicesConfig: {},
        gamesConfig,
        configService: {
          getHouseholdPath: (relative) => path.join(root, relative),
          getHouseholdAuth: () => null,
        },
        eventBus: { broadcast: (topic, payload) => events.push([topic, payload]) },
        httpClient,
        scheduler: { after: () => () => {} },
        now: () => clock,
        newSessionId: () => 'ps_browser_only',
        logger: quiet,
      });
      await r.recordObservation.execute({
        deviceId: 'fitness-console',
        surface: 'browser-emulator',
        observation: {
          state: 'playing', loaded: true, loadId: 'launch-browser-1',
          observedAt: clock, confidenceMs: 0,
          content: { contentId: 'arcade:gb/test' },
        },
      });

      clock = '2026-09-12T20:01:01.000Z';
      await r.sessionMonitor.sweep();

      expect(await r.sessions.findOpenForDevice('fitness-console')).toBeNull();
      expect(events).toContainEqual([
        'arcade-game-sessions', expect.objectContaining({
          event: 'arcade.session.ended', sessionId: 'ps_browser_only', reason: 'lost',
        }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('watches only the declared devices', () => {
    const r = build({ 'art-panel': notMetered, 'livingroom-tv': metered });
    expect(r.trackers).toHaveLength(1);
  });

  it('refuses to meter when no launch package is configured', () => {
    // Without knowing which package is the emulator, "what is in the
    // foreground" cannot distinguish a game from anything else on screen.
    const r = build({ 'livingroom-tv': metered }, { gamesConfig: {} });
    expect(r.trackers).toHaveLength(0);
    expect(r.sessions).not.toBeNull();
    expect(r.recordObservation).not.toBeNull();
  });

  it('starts and stops every tracker it built', async () => {
    const r = build({ 'livingroom-tv': metered, 'other-tv': metered });
    expect(r.trackers).toHaveLength(2);
    await r.start();
    expect(r.trackers.every((t) => t.isRunning)).toBe(true);
    r.stop();
    expect(r.trackers.some((t) => t.isRunning)).toBe(false);
  });

  it('tolerates a device with no ADB fallback — degraded, not broken', () => {
    const noAdb = { arcade_session_observation: true, content_control: { host: '10.0.0.9', port: 2323, auth_ref: 'fullykiosk' } };
    const r = build({ 'livingroom-tv': noAdb });
    expect(r.trackers).toHaveLength(1);
  });

  it('records and broadcasts a hand-started unidentified game through the composed tracker', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-play-composition-'));
    const events = [];
    try {
      const r = createArcadeGameSessionTracking({
        devicesConfig: {
          'livingroom-tv': {
            arcade_session_observation: true,
            content_control: { host: '10.0.0.9', port: 2323, password: 'pw' },
          },
        },
        gamesConfig,
        gamesCatalog: null,
        configService: {
          getHouseholdPath: (relative) => path.join(root, relative),
          getHouseholdAuth: () => null,
        },
        eventBus: { broadcast: (topic, payload) => events.push([topic, payload]) },
        httpClient: { get: async () => ({ status: 200, data: { foregroundApp: 'com.example.emulator' } }) },
        scheduler: { after: () => () => {} },
        now: () => '2026-09-12T20:00:00.000Z',
        newSessionId: () => 'ps_hand_started',
        logger: quiet,
      });

      await r.trackers[0].tick();

      expect((await r.sessions.findOpenForDevice('livingroom-tv'))?.toSnapshot()).toMatchObject({
        id: 'ps_hand_started', content: null, status: 'active',
      });
      expect(events).toContainEqual([
        'arcade-game-sessions', expect.objectContaining({
          event: 'arcade.session.started', deviceId: 'livingroom-tv', contentId: null,
        }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts a bare device map without a `devices` wrapper', () => {
    const r = createArcadeGameSessionTracking({
      devicesConfig: { 'livingroom-tv': metered }, gamesConfig, configService,
      eventBus: { broadcast() {} }, httpClient,
      scheduler: { after: () => () => {} }, now: () => new Date().toISOString(), logger: quiet,
    });
    expect(r.trackers).toHaveLength(1);
  });
});

describe('catalog content resolver', () => {
  const catalog = {
    games: {
      gb: [{ id: 'super-mario-land', rom: '/Games/GB/SML.gb', title: 'Super Mario Land' }],
      snes: [{ id: 'bomberman-2', rom: '/Games/SNES/SB2.sfc', title: 'Super Bomberman 2' }],
    },
  };

  it('maps a device ROM path back to a content id AND its system', async () => {
    const { buildContentResolver } = await import('./arcadeGameSessions.mjs');
    const resolve = buildContentResolver(catalog, { consoles: { snes: { label: 'Super Nintendo', core: 'snes9x.so' } } });
    expect(resolve('/Games/SNES/SB2.sfc')).toEqual({
      contentId: 'arcade:snes/bomberman-2', title: 'Super Bomberman 2',
      console: 'snes', consoleLabel: 'Super Nintendo', core: 'snes9x.so',
    });
  });

  it('separates systems that share a core', async () => {
    // gambatte serves Game Boy AND Game Boy Color; they need different on-screen
    // treatment, so the system must not be inferred from the core.
    const { buildContentResolver } = await import('./arcadeGameSessions.mjs');
    const resolve = buildContentResolver(
      { games: { gb: [{ id: 'a', rom: '/g/a.gb' }], gbc: [{ id: 'b', rom: '/g/b.gbc' }] } },
      { consoles: { gb: { core: 'gambatte.so' }, gbc: { core: 'gambatte.so' } } },
    );
    expect(resolve('/g/a.gb').console).toBe('gb');
    expect(resolve('/g/b.gbc').console).toBe('gbc');
    expect(resolve('/g/a.gb').core).toBe(resolve('/g/b.gbc').core);
  });

  it('returns null for a ROM the catalog does not know', async () => {
    const { buildContentResolver } = await import('./arcadeGameSessions.mjs');
    expect(buildContentResolver(catalog)('/Games/GB/unknown.gb')).toBeNull();
  });

  it('tolerates a missing or empty catalog', async () => {
    const { buildContentResolver } = await import('./arcadeGameSessions.mjs');
    expect(buildContentResolver(null)('/anything')).toBeNull();
    expect(buildContentResolver({ games: {} })('/anything')).toBeNull();
  });

  it('skips catalog entries with no rom path', async () => {
    const { buildContentResolver } = await import('./arcadeGameSessions.mjs');
    const resolve = buildContentResolver({ games: { gb: [{ id: 'x', title: 'X' }] } });
    expect(resolve(undefined)).toBeNull();
  });
});

describe('overlay is a separate declaration from metering', () => {
  const meteredOnly = {
    arcade_session_observation: true,
    content_control: { host: '10.0.0.9', port: 2323, auth_ref: 'fullykiosk', fallback: { provider: 'adb', host: '10.0.0.9' } },
  };
  const meteredWithOverlay = { ...meteredOnly, arcade_session_overlay: true };

  it('builds trackers without an overlay when no device declares one', () => {
    const r = build({ 'livingroom-tv': meteredOnly }, { daylightHost: 'https://host' });
    expect(r.trackers).toHaveLength(1);
  });

  it('still meters when a host for the film is unknown', () => {
    // No daylightHost means no URL can be built; metering must not depend on it.
    const r = build({ 'livingroom-tv': meteredWithOverlay }, { daylightHost: null });
    expect(r.trackers).toHaveLength(1);
  });

  it('starts cleanly with an overlay-declared device', async () => {
    const r = build({ 'livingroom-tv': meteredWithOverlay }, { daylightHost: 'https://host' });
    await expect(r.start()).resolves.not.toThrow();
    r.stop();
  });
});

describe('bezel table', () => {
  const CONSOLES = {
    gb: {
      label: 'Game Boy',
      bezel: {
        source: 'gameboy_animated_border',
        screen: [0.2896, 0.1065, 0.4182, 0.6713],
        zones: [{ name: 'bottom', box: [0, 0.7889, 1, 0.2111], toast: [0.525, 0.7889, 0.2188, 0.1111], orientation: 'wide' }],
      },
    },
    nes: {
      label: 'Nintendo',
      bezel: {
        screen: [0.126, 0.0167, 0.7479, 0.9667],
        zones: [{ name: 'right', box: [0.8802, 0, 0.1198, 1], toast: [0.8802, 0.7926, 0.1198, 0.2028], orientation: 'stacked' }],
      },
    },
  };

  it('parses every console that declares geometry', () => {
    const table = buildBezelTable({ consoles: CONSOLES });
    expect([...table.keys()].sort()).toEqual(['gb', 'nes']);
    expect(table.get('gb').zones[0].name).toBe('bottom');
    expect(table.get('nes').zones[0].orientation).toBe('stacked');
  });

  it('skips a console with no bezel without inventing one', () => {
    const table = buildBezelTable({ consoles: { ...CONSOLES, n64: { label: 'Nintendo 64' } } });
    expect(table.has('n64')).toBe(false);
  });

  // Losing the countdown's position must never cost us the meter: one bad
  // measurement is named and dropped, the rest still load.
  it('drops a console whose geometry is wrong and keeps the others', () => {
    const warnings = [];
    const table = buildBezelTable({
      consoles: {
        ...CONSOLES,
        snes: { label: 'Super Nintendo', bezel: { screen: [0.1, 0.1, 0.8, 0.8], zones: [{ name: 'over', box: [0, 0, 1, 1] }] } },
      },
    }, { warn: (event, data) => warnings.push({ event, ...data }) });

    expect(table.has('snes')).toBe(false);
    expect(table.has('gb')).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].event).toBe('arcade.bezel.invalid');
    expect(warnings[0].system).toBe('snes');
  });

  it('is empty, not broken, when nothing declares geometry', () => {
    expect(buildBezelTable(null).size).toBe(0);
    expect(buildBezelTable({ consoles: {} }).size).toBe(0);
  });
});
