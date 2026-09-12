import { describe, it, expect } from 'vitest';
import { createPlaySessionTracking } from './playSessions.mjs';

const quiet = { info() {}, warn() {}, debug() {}, error() {} };
const httpClient = { get: async () => ({ status: 200, data: {} }) };
const configService = {
  getHouseholdAuth: (ref) => (ref === 'fullykiosk' ? { password: 'pw' } : null),
  getHouseholdPath: (rel) => `/tmp/test-data/${rel}`,
};
const gamesConfig = { launch: { package: 'com.example.emulator' } };

const metered = {
  play_observation: true,
  content_control: {
    provider: 'fully-kiosk', host: '10.0.0.9', port: 2323, auth_ref: 'fullykiosk',
    fallback: { provider: 'adb', host: '10.0.0.9', port: 5555 },
  },
};
const notMetered = { content_control: { provider: 'fully-kiosk', host: '10.0.0.8', port: 2323 } };

const build = (devices, over = {}) => createPlaySessionTracking({
  devicesConfig: { devices }, gamesConfig, configService, eventBus: { broadcast() {} },
  httpClient, scheduler: { after: () => () => {} }, now: () => new Date().toISOString(),
  logger: quiet, ...over,
});

describe('play-session wiring is opt-in per device', () => {
  it('builds nothing when no device declares it', async () => {
    const r = build({ 'art-panel': notMetered, 'office-pc': notMetered });
    expect(r.trackers).toHaveLength(0);
    expect(r.sessions).toBeNull();
    await expect(r.start()).resolves.not.toThrow();
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
    const noAdb = { play_observation: true, content_control: { host: '10.0.0.9', port: 2323, auth_ref: 'fullykiosk' } };
    const r = build({ 'livingroom-tv': noAdb });
    expect(r.trackers).toHaveLength(1);
  });

  it('accepts a bare device map without a `devices` wrapper', () => {
    const r = createPlaySessionTracking({
      devicesConfig: { 'livingroom-tv': metered }, gamesConfig, configService,
      eventBus: { broadcast() {} }, httpClient,
      scheduler: { after: () => () => {} }, now: () => new Date().toISOString(), logger: quiet,
    });
    expect(r.trackers).toHaveLength(1);
  });
});
